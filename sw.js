/* The service worker, and the only reason one exists.

   The board is a single file on purpose. This is the third exception (after
   relay/ and the icons), and it is here because iOS will not deliver a Web
   Push to a home-screen app without one -- there is no other way to put a
   nudge on his lock screen.

   It deliberately has NO fetch handler. A service worker that caches the page
   would fight checkBuild(), which re-fetches index.html with no-store and
   reloads on a new BUILD stamp; a cached copy is exactly the stale-board
   problem that stamp exists to solve. This worker only receives pushes. */

var RELAY = "https://mba-cc-relay.thomasgavin777.workers.dev";

self.addEventListener("install", function(e){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });

/* The push carries no payload.

   Encrypting a body means implementing aes128gcm against the Web Push spec in
   the Worker, and the thing it would buy is one network round trip. A bare
   push wakes this worker and it asks the relay what the message was, which is
   less code in the place that is hardest to debug and keeps the note text out
   of a third party's push service entirely -- it never leaves the relay.

   iOS revokes the permission of a worker that receives a push and shows
   nothing, so every path through here ends in showNotification, including the
   one where the fetch failed. */
self.addEventListener("push", function(e){
  e.waitUntil(
    fetch(RELAY + "/push/latest", {cache:"no-store"})
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(d){
        var title = (d && d.title) || "MBA Command Center";
        var body  = (d && d.body)  || "Something new from Claude.";
        return self.registration.showNotification(title, {
          body: body,
          icon: "icon-180.png",
          badge: "icon-180.png",
          tag: (d && d.tag) || "mbacc",     /* one nudge replaces the last, never a stack of five */
          renotify: true,
          data: {go: (d && d.about) || null}
        });
      })
  );
});

/* Tapping it has to land on the thing it was about. An app already open is
   focused and told where to go; a cold start opens the board on Chat. */
self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var go = (e.notification.data && e.notification.data.go) || null;
  e.waitUntil(
    self.clients.matchAll({type:"window", includeUncontrolled:true}).then(function(ls){
      for(var i=0;i<ls.length;i++){
        if(ls[i].url.indexOf(self.registration.scope) === 0){
          ls[i].postMessage({t:"notif", go:go});
          return ls[i].focus();
        }
      }
      return self.clients.openWindow(go ? "./?go="+encodeURIComponent(go) : "./?v=chat");
    })
  );
});
