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

// The raw, readable bookmarklet body (a `javascript:` URL).
//
// Instagram's signup inputs carry NO name/placeholder and use dynamic React ids
// (e.g. `_r_8_`), so they can't be targeted by a static selector — that's why
// the old name="…" version filled nothing. Instead we identify each field the
// way a human reads the page: by its visible <label> text (+ aria-label) and
// input type, exactly like the automated flow's tagInputByLabel. Values are
// written through the prototype's NATIVE value setter and an input event so
// React's controlled inputs actually register them (a plain `.value =` is
// ignored by React, leaving the form "empty" on submit). Pure DOM API → stays
// friendly to Instagram's CSP. Verified field-by-field against the live
// emailsignup DOM. Birthday is intentionally left for manual entry (IG uses
// custom comboboxes, not fillable inputs).
function autofillSource(draft: AccountDraft): string {
  const payload = JSON.stringify({
    email: draft.email,
    password: draft.password,
    fullName: draft.fullName,
    username: draft.username,
  });
  const body =
    "(function(){" +
    "var d=" +
    payload +
    ";" +
    "function vis(el){var cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}" +
    "function lab(el){var t='';try{if(el.labels&&el.labels.length)t=Array.prototype.map.call(el.labels,function(l){return l.textContent;}).join(' ');}catch(e){}" +
    "if(!t){var L=el.closest('label');if(L)t=L.textContent;}" +
    "return(t+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).replace(/\\s+/g,' ').trim().toLowerCase();}" +
    "function setv(el,val){if(!el)return false;var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
    "var s=Object.getOwnPropertyDescriptor(p,'value').set;try{el.focus();}catch(e){}s.call(el,val);" +
    "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));try{el.blur();}catch(e){}return true;}" +
    "var inputs=Array.prototype.slice.call(document.querySelectorAll('input,textarea')).filter(vis);" +
    "var used=[];function take(pred){for(var i=0;i<inputs.length;i++){var el=inputs[i];if(used.indexOf(el)>=0)continue;if(pred(el,lab(el))){used.push(el);return el;}}return null;}" +
    "var n=0;" +
    "if(setv(take(function(el){return el.type==='password';}),d.password))n++;" +
    "if(setv(take(function(el,t){return el.type==='email'||/email|mobile|phone/.test(t);}),d.email))n++;" +
    "if(setv(take(function(el,t){return el.type==='search'||/username/.test(t);}),d.username))n++;" +
    "if(setv(take(function(el,t){return /name/.test(t);}),d.fullName))n++;" +
    "if(!n){alert('Fastpost: no Instagram signup fields found here. Open instagram.com/accounts/emailsignup/ first, then click this on that tab.');return;}" +
    "var t=document.createElement('div');t.textContent='Fastpost filled '+n+' of 4 fields — now set your birthday & submit';" +
    "t.style.cssText='position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);background:#111;color:#fff;font:600 13px system-ui;padding:10px 16px;border-radius:9999px;box-shadow:0 8px 30px rgba(0,0,0,.35)';" +
    "document.body.appendChild(t);setTimeout(function(){t.remove();},3200);})();";
  return "javascript:" + body;
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
