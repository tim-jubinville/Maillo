// Moves browser storage saved under the app's former name (Mailmax). Imported first so
// every other module reads the new keys.
for (const store of [localStorage, sessionStorage]) {
  try {
    for (const key of Object.keys(store)) {
      if (!key.startsWith('mailmax.')) continue;
      const next = 'maillo.' + key.slice('mailmax.'.length);
      if (store.getItem(next) === null) store.setItem(next, store.getItem(key) ?? '');
      store.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

export {};
