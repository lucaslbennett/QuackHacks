// Client for the guided, user-driven Instagram account build flow
// (server/routes/accounts.js).
//
// Instead of a headless bot fighting Instagram's defenses, we generate the
// account identity + a real inbox server-side, then let the user finish signup
// in their own browser. We autofill what we can (via a bookmarklet) and watch
// the inbox so the verification code shows up in-app automatically.

export interface AccountBirthday {
  monthName: string;
  month: number;
  day: number;
  year: number;
  label: string;
}

export interface AccountDraft {
  draftId: string;
  fullName: string;
  username: string;
  password: string;
  email: string;
  birthday: AccountBirthday;
  signupUrl: string;
  emailProvider: string;
  createdAt: number;
}

export interface DraftInput {
  name?: string;
  niche?: string | null;
  seed?: string;
  persona?: { displayName?: string; handleSuggestions?: string[] } | null;
}

// Generate a fresh identity + provision a real inbox-backed email.
export async function createAccountDraft(input: DraftInput = {}): Promise<AccountDraft> {
  const res = await fetch("/api/account/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Couldn't generate account details (${res.status})`);
  }
  return data as AccountDraft;
}

// One poll for Instagram's verification code in the draft's inbox.
export async function pollAccountCode(
  draftId: string,
): Promise<{ code: string | null; email?: string }> {
  const res = await fetch(`/api/account/draft/${draftId}/code`);
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Couldn't check for the code (${res.status})`);
  }
  return { code: data.code ?? null, email: data.email };
}

// The raw, readable bookmarklet body (a `javascript:` URL). Fills Instagram's
// signup fields using the NATIVE value setter so React's controlled inputs
// actually register the change — assigning `.value` directly does not fire
// React's onChange, leaving the form "empty" on submit. Pure DOM API, so it
// stays friendly to Instagram's Content-Security-Policy. Selectors mirror the
// ones the automated flow uses against the live signup DOM.
function autofillSource(draft: AccountDraft): string {
  const payload = JSON.stringify({
    email: draft.email,
    fullName: draft.fullName,
    username: draft.username,
    password: draft.password,
  });
  return (
    "javascript:(function(){var d=" +
    payload +
    ";function set(sel,val){var el=document.querySelector(sel);if(!el)return false;" +
    "var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
    "var s=Object.getOwnPropertyDescriptor(p,'value').set;s.call(el,val);" +
    "el.dispatchEvent(new Event('input',{bubbles:true}));" +
    "el.dispatchEvent(new Event('change',{bubbles:true}));" +
    "el.dispatchEvent(new Event('blur',{bubbles:true}));return true;}" +
    "var n=0;" +
    "if(set('input[name=\"emailOrPhone\"],input[name=\"email\"],input[type=\"email\"]',d.email))n++;" +
    "if(set('input[name=\"fullName\"]',d.fullName))n++;" +
    "if(set('input[name=\"username\"]',d.username))n++;" +
    "if(set('input[name=\"password\"],input[type=\"password\"]',d.password))n++;" +
    "if(!n){alert('Fastpost: no Instagram signup fields here. Open instagram.com/accounts/emailsignup/ first, then click this.');return;}" +
    "var t=document.createElement('div');t.textContent='Fastpost filled '+n+' field(s)';" +
    "t.style.cssText='position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);background:#111;color:#fff;font:600 13px system-ui;padding:10px 16px;border-radius:9999px;box-shadow:0 8px 30px rgba(0,0,0,.35)';" +
    "document.body.appendChild(t);setTimeout(function(){t.remove();},2600);})();"
  );
}

// Readable form for "Copy autofill code" (paste into a new bookmark's URL).
export function autofillCode(draft: AccountDraft): string {
  return autofillSource(draft);
}

// Encoded form for an <a href> the user can drag straight to their bookmarks
// bar. encodeURIComponent keeps the JS intact through the href; the browser
// decodes and runs it on click.
export function autofillHref(draft: AccountDraft): string {
  const src = autofillSource(draft);
  return "javascript:" + encodeURIComponent(src.slice("javascript:".length));
}

// Best-effort clipboard copy that also works outside secure contexts.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
