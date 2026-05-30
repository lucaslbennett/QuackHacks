async function req(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  status: () => req("/status"),
  listInfluencers: () => req("/influencers"),
  getInfluencer: (id) => req(`/influencers/${id}`),
  createInfluencer: (body) => req("/influencers", { method: "POST", body }),
  patchInfluencer: (id, body) => req(`/influencers/${id}`, { method: "PATCH", body }),
  deleteInfluencer: (id) => req(`/influencers/${id}`, { method: "DELETE" }),
  setAccount: (id, body) => req(`/influencers/${id}/account`, { method: "POST", body }),
  addSource: (id, body) => req(`/influencers/${id}/sources`, { method: "POST", body }),
  action: (id, action, body = {}) =>
    req(`/influencers/${id}/actions/${action}`, { method: "POST", body }),
  submitCode: (id, kind, code) =>
    req(`/verification/${id}/${kind}`, { method: "POST", body: { code } }),
};
