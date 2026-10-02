/* Push notifications, loaded into the generated service worker via importScripts. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Water Delivery';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: data.url || '/' },
    }),
  );
});

/** Open (or focus) the app at the notification's page. Only same-origin paths are followed. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/** The browser rotated the subscription: re-register it so notifications keep arriving. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription && event.oldSubscription.options;
      if (!options) return;
      const sub = await self.registration.pushManager.subscribe(options);
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    })(),
  );
});
