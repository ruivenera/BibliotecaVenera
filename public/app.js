/* Venera — biblioteca de estudo. Estado local primeiro, servidor a seguir. */

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const DIA = 864e5;

const COR = {
  "financas-geopolitica": "var(--latao)",
  "inteligencia-artificial": "var(--indigo)",
};
let NOMES = {
  "financas-geopolitica": "Finanças & Geopolítica",
  "inteligencia-artificial": "Inteligência Artificial",
};

/* --------------------------------------------------------------- estado --- */

const guardado = (chave, valorInicial) => {
  try {
    return JSON.parse(localStorage.getItem(chave)) ?? valorInicial;
  } catch {
    return valorInicial;
  }
};

const estado = {
  chave: localStorage.getItem("venera:chave") || "",
  biblioteca: guardado("venera:biblioteca", { notas: {}, cartoes: {} }),
  sujos: new Set(guardado("venera:sujos", [])),
  desde: guardado("venera:desde", 0),
  vista: "estante",
  edicaoAberta: null,
  fila: [],
  cartaoAtual: null,
  versoVisivel: false,
};

function gravarLocal() {
  localStorage.setItem("venera:biblioteca", JSON.stringify(estado.biblioteca));
  localStorage.setItem("venera:sujos", JSON.stringify([...estado.sujos]));
  localStorage.setItem("venera:desde", JSON.stringify(estado.desde));
}

/** Marca um item como alterado: carimba a hora, grava e agenda sincronização. */
function alterar(tipo, item) {
  item.atualizado_em = Date.now();
  estado.biblioteca[tipo][item.id] = item;
  estado.sujos.add(`${tipo}:${item.id}`);
  gravarLocal();
  agendarSync();
}

const vivos = (tipo) => Object.values(estado.biblioteca[tipo]).filter((i) => !i.apagado);

/* ------------------------------------------------------------------ rede --- */

function marcarEstado(texto, tipo) {
  const alvo = $("#estado");
  alvo.textContent = texto;
  alvo.dataset.estado = tipo;
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${estado.chave}`,
      ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
      ...opcoes.headers,
    },
  });
  if (resposta.status === 401) {
    localStorage.removeItem("venera:chave");
    estado.chave = "";
    irPara("chave");
    throw new Error("chave recusada");
  }
  if (!resposta.ok) throw new Error(`http ${resposta.status}`);
  return resposta.json();
}

let temporizador;
function agendarSync() {
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, 1200);
}

async function sincronizar() {
  if (!estado.chave) return;
  if (!navigator.onLine) return marcarEstado("offline", "offline");

  marcarEstado("a sincronizar", "a-sincronizar");
  const porEnviar = { notas: [], cartoes: [] };
  for (const marca of estado.sujos) {
    const [tipo, item] = marca.split(":");
    const dados = estado.biblioteca[tipo]?.[item];
    if (dados) porEnviar[tipo].push(dados);
  }

  try {
    const r = await api("/api/sync", {
      method: "POST",
      body: JSON.stringify({ desde: estado.desde, ...porEnviar }),
    });
    for (const tipo of ["notas", "cartoes"]) {
      for (const vindo of r[tipo]) {
        const atual = estado.biblioteca[tipo][vindo.id];
        if (!atual || vindo.atualizado_em > atual.atualizado_em) {
          estado.biblioteca[tipo][vindo.id] = vindo;
        }
      }
    }
    estado.sujos.clear();
    estado.desde = r.agora;
    gravarLocal();
    marcarEstado("guardado", "ligado");
    contarRevisao();
    if (estado.vista === "notas") desenharNotas();
  } catch (erro) {
    marcarEstado(navigator.onLine ? "por guardar" : "offline", "offline");
  }
}

/* ----------------------------------------------------------------- rotas --- */

const VISTAS = ["chave", "estante", "edicao", "notas", "revisao"];

function irPara(vista, ...args) {
  estado.vista = vista;
  VISTAS.forEach((v) => {
    const alvo = $(`#v-${v}`);
    if (alvo) alvo.dataset.ativa = v === vista ? "sim" : "nao";
  });
  document.querySelectorAll(".aba").forEach((aba) => {
    const ativa = aba.dataset.ir === vista || (vista === "edicao" && aba.dataset.ir === "estante");
    aba.setAttribute("aria-current", ativa ? "page" : "false");
  });
  window.scrollTo({ top: 0, behavior: "instant" });

  if (vista === "estante") carregarEstante();
  if (vista === "notas") desenharNotas();
  if (vista === "revisao") comecarRevisao();
  if (vista === "edicao") abrirEdicao(...args);
}

/* --------------------------------------------------------------- estante --- */

const dataCurta = (iso) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const porExtenso = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

async function carregarEstante() {
  try {
    const [estanteDados, feed] = await Promise.all([api("/api/estante"), api("/api/feed")]);
    NOMES = estanteDados.rotinas || NOMES;
    marcarEstado("guardado", "ligado");
    desenharEstante(estanteDados.lombadas);
    desenharDossies(feed);
  } catch {
    marcarEstado(navigator.onLine ? "sem ligação" : "offline", "offline");
    if (!$("#estante").children.length) {
      $("#dossies").innerHTML = vazio(
        "A estante não respondeu",
        "Verifica a ligação. O que já leste continua disponível offline."
      );
    }
  }
}

const vazio = (titulo, texto, botao = "") =>
  `<div class="vazio"><strong>${esc(titulo)}</strong><p>${esc(texto)}</p>${botao}</div>`;

function desenharEstante(lombadas) {
  const hoje = new Date().toISOString().slice(0, 10);
  const alvo = $("#estante");

  if (!lombadas.length) {
    alvo.innerHTML = `<p class="rotulo" style="align-self:center">sem volumes arquivados</p>`;
    return;
  }

  alvo.innerHTML = lombadas
    .map((l) => {
      const altura = Math.min(126, 74 + l.itens * 8);
      return `<button class="lombada"
        style="height:${altura}px;background-color:${COR[l.rotina] || "var(--latao)"}"
        data-hoje="${l.data === hoje ? "sim" : "nao"}"
        data-rotina="${esc(l.rotina)}" data-data="${esc(l.data)}"
        title="${esc(NOMES[l.rotina])} — ${esc(l.titulo)}">${esc(dataCurta(l.data))}</button>`;
    })
    .join("");
}

function desenharDossies(feed) {
  const alvo = $("#dossies");
  $("#data-hoje").textContent = feed.edicoes[0] ? porExtenso(feed.edicoes[0].data) : "";

  const cartoes = feed.edicoes.map(
    (e) => `<button class="dossie" style="--marcador:${COR[e.rotina]}"
      data-rotina="${esc(e.rotina)}" data-data="${esc(e.data)}">
      <span class="rotulo" style="color:${COR[e.rotina]}">${esc(NOMES[e.rotina] || e.rotina)}</span>
      <h3>${esc(e.titulo)}</h3>
      <p>${esc(e.resumo)}</p>
      <span class="linha-meta rotulo">${e.itens.length} temas · ${esc(dataCurta(e.data))}</span>
    </button>`
  );

  const faltam = (feed.em_falta || []).map((r) =>
    vazio(NOMES[r] || r, "A rotina ainda não arquivou nada. A próxima corrida é às 07:00.")
  );

  alvo.innerHTML =
    cartoes.concat(faltam).join("") ||
    vazio("A estante está vazia", "Assim que as rotinas correrem, a primeira edição aparece aqui.");
}

/* --------------------------------------------------------------- leitura --- */

async function abrirEdicao(rotina, data) {
  const cabecalho = $("#edicao-cabecalho");
  const itens = $("#edicao-itens");
  cabecalho.innerHTML = `<p class="rotulo" style="margin-top:1.4rem">a abrir…</p>`;
  itens.innerHTML = "";

  let edicao;
  try {
    edicao = await api(`/api/edicao/${rotina}/${data}`);
  } catch {
    cabecalho.innerHTML = vazio(
      "Não foi possível abrir",
      "Esta edição ainda não está guardada neste aparelho e não há ligação."
    );
    return;
  }

  estado.edicaoAberta = edicao;
  const cor = COR[edicao.rotina];

  cabecalho.innerHTML = `
    <p class="rotulo" style="color:${cor};margin-top:1.4rem">${esc(NOMES[edicao.rotina] || edicao.rotina)}</p>
    <h1 class="titulo-grande">${esc(edicao.titulo)}</h1>
    <p class="linha-meta rotulo">${esc(porExtenso(edicao.data))} · ${edicao.itens.length} temas</p>
    <p class="resumo">${esc(edicao.resumo)}</p>`;

  itens.innerHTML = edicao.itens
    .map((item, i) => {
      const partes = String(item.texto).split(/Porque interessa:\s*/i);
      const corpo = partes[0].trim();
      // O rótulo já diz "Porque interessa", por isso a frase começa em maiúscula.
      const porque = partes[1]?.trim().replace(/^./, (c) => c.toUpperCase());
      return `<article class="verbete" style="--marcador:${cor}">
        <span class="impacto rotulo" data-nivel="${esc(item.impacto)}">
          <i></i><i></i><i></i> impacto ${esc(item.impacto)}
        </span>
        <h3>${esc(item.titulo)}</h3>
        <p>${esc(corpo)}</p>
        ${porque ? `<div class="porque"><b>Porque interessa</b>${esc(porque)}</div>` : ""}
        <div class="fontes">${item.fontes
          .map(
            (f) =>
              `<a class="fonte" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titulo)} ↗</a>`
          )
          .join("")}</div>
        <div class="accoes">
          <button class="btn" data-acao="nota" data-item="${i}">Guardar nota</button>
          <button class="btn" data-acao="cartao" data-item="${i}">Fazer cartão</button>
        </div>
      </article>`;
    })
    .join("");
}

/* ----------------------------------------------------------------- notas --- */

function desenharNotas() {
  const procura = $("#procura").value.trim().toLowerCase();
  const lista = vivos("notas")
    .filter((n) => !procura || `${n.titulo} ${n.texto}`.toLowerCase().includes(procura))
    .sort((a, b) => b.atualizado_em - a.atualizado_em);

  $("#lista-notas").innerHTML = lista.length
    ? lista
        .map(
          (n) => `<article class="nota" data-nota="${esc(n.id)}">
            <h4>${esc(n.titulo || "Sem título")}</h4>
            <p>${esc(n.texto)}</p>
            <span class="linha-meta rotulo">${
              n.origem ? esc(NOMES[n.origem.rotina] || n.origem.rotina) + " · " + esc(dataCurta(n.origem.data)) : "nota solta"
            }</span>
          </article>`
        )
        .join("")
    : procura
    ? vazio("Nada encontrado", "Nenhuma nota tem essas palavras.")
    : vazio("Ainda não há notas", "Abre uma edição e guarda o que interessa — ou escreve uma nota solta.");
}

/* --------------------------------------------------------------- revisão --- */

const NOTAS_SM2 = [
  { q: 1, rotulo: "Outra vez" },
  { q: 3, rotulo: "Difícil" },
  { q: 4, rotulo: "Bom" },
  { q: 5, rotulo: "Fácil" },
];

/**
 * SM-2 com dois desvios deliberados: no algoritmo original, "Difícil" e "Bom"
 * dão sempre o mesmo intervalo e só mexem na facilidade — os botões ficariam
 * todos com o mesmo prazo. Aqui "Fácil" salta à frente e "Difícil" avança devagar.
 * q<3 devolve o cartão ao fim da sessão em vez de o adiar para outro dia.
 */
function agendar(sm2, q) {
  let { intervalo, facilidade, repeticoes, revisoes } = sm2;
  if (q < 3) {
    repeticoes = 0;
    intervalo = 0;
  } else {
    repeticoes += 1;
    if (repeticoes === 1) intervalo = q === 5 ? 4 : 1;
    else if (repeticoes === 2) intervalo = q === 5 ? 10 : 6;
    else if (q === 3) intervalo = Math.max(intervalo + 1, Math.round(intervalo * 1.2));
    else intervalo = Math.round(intervalo * facilidade * (q === 5 ? 1.3 : 1));
  }
  facilidade = Math.max(1.3, facilidade + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return {
    intervalo,
    facilidade: Number(facilidade.toFixed(2)),
    repeticoes,
    revisoes: (revisoes || 0) + 1,
    proxima: Date.now() + (intervalo === 0 ? 6e5 : intervalo * DIA),
  };
}

const prazo = (dias) => (dias === 0 ? "10 min" : dias === 1 ? "1 dia" : `${dias} dias`);

const devidos = () => vivos("cartoes").filter((c) => (c.sm2?.proxima || 0) <= Date.now());

function contarRevisao() {
  const n = devidos().length;
  const alvo = $("#conta-revisao");
  alvo.textContent = n || "";
  alvo.dataset.zero = n ? "nao" : "sim";
}

function comecarRevisao() {
  estado.fila = devidos().sort((a, b) => a.sm2.proxima - b.sm2.proxima);
  estado.total = estado.fila.length;
  proximoCartao();
}

function proximoCartao() {
  estado.cartaoAtual = estado.fila[0] || null;
  estado.versoVisivel = false;
  desenharRevisao();
}

function desenharRevisao() {
  const palco = $("#palco-revisao");
  const feitos = (estado.total || 0) - estado.fila.length;
  $("#progresso-revisao").textContent = estado.total ? `${feitos} de ${estado.total}` : "";
  $("#barra-revisao").style.width = estado.total ? `${(feitos / estado.total) * 100}%` : "0%";

  if (!estado.cartaoAtual) {
    const totalCartoes = vivos("cartoes").length;
    palco.innerHTML = totalCartoes
      ? vazio("Revisão em dia", "Os cartões voltam sozinhos quando chegar a altura de os rever.")
      : vazio("Ainda não há cartões", "Abre uma edição e transforma um tema num cartão.");
    contarRevisao();
    return;
  }

  const c = estado.cartaoAtual;
  palco.innerHTML = `
    <div class="cartao">
      <div class="frente">${esc(c.frente)}</div>
      ${estado.versoVisivel ? `<div class="verso">${esc(c.verso)}</div>` : ""}
    </div>
    ${
      estado.versoVisivel
        ? `<div class="notas-revisao">${NOTAS_SM2.map(
            (n) =>
              `<button class="btn" data-nota-sm2="${n.q}">${n.rotulo}<small>${prazo(
                agendar(c.sm2, n.q).intervalo
              )}</small></button>`
          ).join("")}</div>`
        : `<div class="accoes" style="margin-top:0.9rem">
             <button class="btn" data-tom="forte" id="btn-ver" style="flex:1">Ver resposta</button>
             <button class="btn" data-editar-cartao="${esc(c.id)}">Editar</button>
           </div>`
    }`;
}

function classificar(q) {
  const c = estado.cartaoAtual;
  c.sm2 = agendar(c.sm2, q);
  alterar("cartoes", c);
  estado.fila.shift();
  if (q < 3) estado.fila.push(c); // volta no fim da sessão
  proximoCartao();
}

/* ----------------------------------------------------------------- folha --- */

const folha = $("#folha");
let contexto = null;

function abrirFolha(modo, dados = {}) {
  contexto = { modo, ...dados };
  const nota = modo.startsWith("nota");
  $("#folha-rotulo").textContent = dados.origem
    ? `${NOMES[dados.origem.rotina] || dados.origem.rotina} · ${dataCurta(dados.origem.data)}`
    : "nota solta";
  $("#folha-titulo").textContent = {
    "nota-nova": "Nova nota",
    "nota-editar": "Editar nota",
    "cartao-novo": "Novo cartão",
    "cartao-editar": "Editar cartão",
  }[modo];
  $("#folha-frente").placeholder = nota ? "Título" : "Frente — a pergunta";
  $("#folha-verso").placeholder = nota ? "O que queres guardar" : "Verso — a resposta";
  $("#folha-frente").value = dados.frente || "";
  $("#folha-verso").value = dados.verso || "";
  $("#folha-aviso").textContent = "";
  $("#folha-apagar").hidden = !modo.endsWith("editar");
  $("#folha-para-cartao").hidden = modo !== "nota-editar";
  folha.showModal();
  $("#folha-frente").focus();
}

function guardarFolha() {
  const frente = $("#folha-frente").value.trim();
  const verso = $("#folha-verso").value.trim();
  const nota = contexto.modo.startsWith("nota");

  if (!nota && !frente) return ($("#folha-aviso").textContent = "A frente do cartão não pode ficar vazia.");
  if (nota && !frente && !verso) return ($("#folha-aviso").textContent = "Escreve um título ou um texto.");

  if (nota) {
    const item = estado.biblioteca.notas[contexto.id] || {
      id: id(),
      criado_em: Date.now(),
      origem: contexto.origem || null,
      apagado: false,
    };
    alterar("notas", { ...item, titulo: frente, texto: verso });
    desenharNotas();
  } else {
    const item = estado.biblioteca.cartoes[contexto.id] || {
      id: id(),
      criado_em: Date.now(),
      origem: contexto.origem || null,
      apagado: false,
      sm2: { intervalo: 0, facilidade: 2.5, repeticoes: 0, proxima: Date.now(), revisoes: 0 },
    };
    alterar("cartoes", { ...item, frente, verso });
    contarRevisao();
    if (estado.vista === "revisao") desenharRevisao();
  }
  folha.close();
}

function apagarFolha() {
  const tipo = contexto.modo.startsWith("nota") ? "notas" : "cartoes";
  const item = estado.biblioteca[tipo][contexto.id];
  if (item) alterar(tipo, { ...item, apagado: true });
  folha.close();
  if (tipo === "notas") desenharNotas();
  else {
    estado.fila = estado.fila.filter((c) => c.id !== contexto.id);
    contarRevisao();
    proximoCartao();
  }
}

/* ---------------------------------------------------------------- eventos --- */

document.addEventListener("click", (evento) => {
  const alvo = evento.target.closest("[data-ir], [data-rotina], [data-acao], [data-nota], [data-nota-sm2], [data-editar-cartao], #btn-ver, #btn-nota-nova, #btn-chave, #folha-guardar, #folha-cancelar, #folha-apagar, #folha-para-cartao, #estado");
  if (!alvo) return;

  if (alvo.dataset.ir) return irPara(alvo.dataset.ir);
  if (alvo.dataset.rotina) return irPara("edicao", alvo.dataset.rotina, alvo.dataset.data);

  if (alvo.dataset.acao) {
    const item = estado.edicaoAberta.itens[Number(alvo.dataset.item)];
    const origem = { rotina: estado.edicaoAberta.rotina, data: estado.edicaoAberta.data };
    const texto = String(item.texto).replace(/\s*Porque interessa:\s*/i, "\n\nPorque interessa: ");
    if (alvo.dataset.acao === "nota") {
      abrirFolha("nota-nova", { origem, frente: item.titulo, verso: texto });
    } else {
      abrirFolha("cartao-novo", { origem, frente: "", verso: texto });
    }
    return;
  }

  if (alvo.dataset.nota) {
    const n = estado.biblioteca.notas[alvo.dataset.nota];
    return abrirFolha("nota-editar", { id: n.id, frente: n.titulo, verso: n.texto, origem: n.origem });
  }

  if (alvo.dataset.editarCartao) {
    const c = estado.biblioteca.cartoes[alvo.dataset.editarCartao];
    return abrirFolha("cartao-editar", { id: c.id, frente: c.frente, verso: c.verso, origem: c.origem });
  }

  if (alvo.dataset.notaSm2) return classificar(Number(alvo.dataset.notaSm2));

  switch (alvo.id) {
    case "btn-ver":
      estado.versoVisivel = true;
      return desenharRevisao();
    case "btn-nota-nova":
      return abrirFolha("nota-nova", {});
    case "btn-chave":
      return ligar();
    case "folha-guardar":
      return guardarFolha();
    case "folha-cancelar":
      return folha.close();
    case "folha-apagar":
      return apagarFolha();
    case "folha-para-cartao": {
      const titulo = $("#folha-frente").value.trim();
      const corpo = $("#folha-verso").value.trim();
      folha.close();
      return abrirFolha("cartao-novo", { origem: contexto.origem, frente: titulo, verso: corpo });
    }
    case "estado":
      return sincronizar();
  }
});

$("#procura").addEventListener("input", desenharNotas);
$("#campo-chave").addEventListener("keydown", (e) => e.key === "Enter" && ligar());

document.addEventListener("keydown", (evento) => {
  if (estado.vista !== "revisao" || folha.open || !estado.cartaoAtual) return;
  if (evento.key === " " && !estado.versoVisivel) {
    evento.preventDefault();
    estado.versoVisivel = true;
    return desenharRevisao();
  }
  if (estado.versoVisivel && ["1", "2", "3", "4"].includes(evento.key)) {
    classificar(NOTAS_SM2[Number(evento.key) - 1].q);
  }
});

window.addEventListener("online", sincronizar);
window.addEventListener("offline", () => marcarEstado("offline", "offline"));

/* --------------------------------------------------------------- arranque --- */

async function ligar() {
  const chave = $("#campo-chave").value.trim();
  if (!chave) return ($("#aviso-chave").textContent = "Cola a chave para continuar.");
  $("#btn-chave").disabled = true;
  $("#aviso-chave").textContent = "";
  try {
    const r = await fetch("/api/chave", { headers: { Authorization: `Bearer ${chave}` } });
    if (!r.ok) throw new Error();
    estado.chave = chave;
    localStorage.setItem("venera:chave", chave);
    $("#campo-chave").value = "";
    irPara("estante");
    sincronizar();
  } catch {
    $("#aviso-chave").textContent = "Chave recusada. Confirma que copiaste a chave da app, não a das rotinas.";
  } finally {
    $("#btn-chave").disabled = false;
  }
}

contarRevisao();
if (estado.chave) {
  irPara("estante");
  sincronizar();
} else {
  irPara("chave");
  marcarEstado("por ligar", "parado");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
