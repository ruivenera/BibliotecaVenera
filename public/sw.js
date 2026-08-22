/* Venera — offline. O que já leste continua a abrir sem rede. */

const VERSAO = "venera-v25";
const CASCA = ["/", "/index.html", "/app.js", "/manifest.json", "/icone.svg"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;

  const url = new URL(pedido.url);
  const mesmaOrigem = url.origin === location.origin;

  // Edições: rede primeiro, cache como rede de segurança.
  // A sincronização de notas é POST e nunca passa por aqui.
  if (mesmaOrigem && url.pathname.startsWith("/api/")) {
    evento.respondWith(
      fetch(pedido)
        .then((resposta) => {
          if (resposta.ok && url.pathname.startsWith("/api/edicao")) {
            const copia = resposta.clone();
            caches.open(VERSAO).then((c) => c.put(pedido, copia));
          }
          return resposta;
        })
        .catch(() => caches.match(pedido).then((r) => r || Promise.reject(new Error("offline"))))
    );
    return;
  }

  // Tipos de letra: cache primeiro, para a app abrir igual sem rede.
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com")) {
    evento.respondWith(
      caches.match(pedido).then(
        (guardado) =>
          guardado ||
          fetch(pedido).then((resposta) => {
            const copia = resposta.clone();
            caches.open(VERSAO).then((c) => c.put(pedido, copia));
            return resposta;
          })
      )
    );
    return;
  }

  // Fotos do Commons: cache primeiro. Uma vez vista, a imagem do tema volta a
  // abrir no metro sem rede, e nunca se pede duas vezes o mesmo ficheiro.
  if (url.hostname === "upload.wikimedia.org") {
    evento.respondWith(
      caches.match(pedido).then(
        (guardado) =>
          guardado ||
          fetch(pedido)
            .then((resposta) => {
              if (resposta.ok) {
                const copia = resposta.clone();
                caches.open(VERSAO).then((c) => c.put(pedido, copia));
              }
              return resposta;
            })
            .catch(() => Response.error())
      )
    );
    return;
  }

  if (!mesmaOrigem) return;

  // A casca vai a rede primeiro. Com cache primeiro, uma versão nova só
  // aparecia à segunda abertura — e a app tem nome, menu e código a mudar.
  // Os ícones e o manifest, esses, podem vir da cache: mudam de longe a longe.
  const casca = pedido.mode === "navigate" || /\.(html|js)$/.test(url.pathname) || url.pathname === "/";

  if (casca) {
    evento.respondWith(
      fetch(pedido)
        .then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone();
            caches.open(VERSAO).then((c) => c.put(pedido, copia));
          }
          return resposta;
        })
        .catch(() =>
          caches
            .match(pedido)
            .then((r) => r || (pedido.mode === "navigate" ? caches.match("/index.html") : null))
            .then((r) => r || Promise.reject(new Error("offline")))
        )
    );
    return;
  }

  evento.respondWith(
    caches.match(pedido).then((guardado) => guardado || fetch(pedido))
  );
});
