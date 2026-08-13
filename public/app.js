/* Venera — biblioteca de estudo. Estado local primeiro, servidor a seguir. */

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const DIA = 864e5;
const TIPOS = ["notas", "cartoes", "livros"];

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
  biblioteca: guardado("venera:biblioteca", { notas: {}, cartoes: {}, livros: {} }),
  sujos: new Set(guardado("venera:sujos", [])),
  desde: guardado("venera:desde", 0),
  vista: "estante",
  edicaoAberta: null,
  fila: [],
  cartaoAtual: null,
  versoVisivel: false,
};

// Quem já usava a app tem uma biblioteca gravada sem a gaveta dos livros.
for (const tipo of TIPOS) estado.biblioteca[tipo] ||= {};

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
  const porEnviar = { notas: [], cartoes: [], livros: [] };
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
    for (const tipo of TIPOS) {
      for (const vindo of r[tipo] || []) {
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

const VISTAS = [
  "chave",
  "noticias",
  "aprendizagem",
  "leitura",
  "notas",
  "revisao",
  "definicoes",
  "edicao",
];

/** Cada rotina tem o seu módulo: as edições deixaram de partilhar uma estante. */
const MODULO = {
  "financas-geopolitica": "noticias",
  "inteligencia-artificial": "aprendizagem",
};
const ROTINA_DO_MODULO = { noticias: "financas-geopolitica", aprendizagem: "inteligencia-artificial" };

function irPara(vista, ...args) {
  estado.vista = vista;
  VISTAS.forEach((v) => {
    const alvo = $(`#v-${v}`);
    if (alvo) alvo.dataset.ativa = v === vista ? "sim" : "nao";
  });
  document.querySelectorAll(".aba").forEach((aba) => {
    const ativa =
      aba.dataset.ir === vista || (vista === "edicao" && aba.dataset.ir === estado.moduloOrigem);
    aba.setAttribute("aria-current", ativa ? "page" : "false");
  });
  window.scrollTo({ top: 0, behavior: "instant" });

  if (ROTINA_DO_MODULO[vista]) carregarModulo(ROTINA_DO_MODULO[vista]);
  if (vista === "leitura") desenharLivros();
  if (vista === "notas") { desenharQuote(); desenharNotas(); }
  if (vista === "revisao") comecarRevisao();
  if (vista === "definicoes") desenharDefinicoes();
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

/** Um pedido serve os dois módulos; sem isto trocar de aba refazia tudo. */
let cacheEstante = { quando: 0, dados: null };

async function buscarEstante() {
  if (cacheEstante.dados && Date.now() - cacheEstante.quando < 30000) return cacheEstante.dados;
  const [estanteDados, feed] = await Promise.all([api("/api/estante"), api("/api/feed")]);
  cacheEstante = { quando: Date.now(), dados: { estanteDados, feed } };
  return cacheEstante.dados;
}

async function carregarModulo(rotina) {
  const modulo = MODULO[rotina];
  try {
    const { estanteDados, feed } = await buscarEstante();
    NOMES = estanteDados.rotinas || NOMES;
    marcarEstado("guardado", "ligado");
    desenharEstante(estanteDados.lombadas.filter((l) => l.rotina === rotina), modulo);
    desenharDossies(feed.edicoes.filter((e) => e.rotina === rotina), rotina, modulo);
  } catch {
    marcarEstado(navigator.onLine ? "sem ligação" : "offline", "offline");
    if (!$(`#estante-${modulo}`).children.length) {
      $(`#dossies-${modulo}`).innerHTML = vazio(
        "Não foi possível carregar",
        "Verifica a ligação. O que já leste continua disponível offline."
      );
    }
  }
}

const vazio = (titulo, texto, botao = "") =>
  `<div class="vazio"><strong>${esc(titulo)}</strong><p>${esc(texto)}</p>${botao}</div>`;

function desenharEstante(lombadas, modulo) {
  const hoje = new Date().toISOString().slice(0, 10);
  const alvo = $(`#estante-${modulo}`);

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

function desenharDossies(edicoes, rotina, modulo) {
  const alvo = $(`#dossies-${modulo}`);
  $(`#data-${modulo}`).textContent = edicoes[0] ? porExtenso(edicoes[0].data) : "";

  alvo.innerHTML =
    edicoes
      .map(
        (e) => `<button class="dossie" style="--marcador:${COR[e.rotina]}"
      data-rotina="${esc(e.rotina)}" data-data="${esc(e.data)}">
      <span class="rotulo" style="color:${COR[e.rotina]}">${esc(NOMES[e.rotina] || e.rotina)}</span>
      <h3>${esc(e.titulo)}</h3>
      <p>${esc(e.resumo)}</p>
      <span class="linha-meta rotulo">${e.itens.length} temas · ${esc(dataCurta(e.data))}</span>
    </button>`
      )
      .join("") ||
    vazio(
      NOMES[rotina] || rotina,
      "A rotina ainda não arquivou nada aqui. A edição aparece assim que a próxima corrida terminar."
    );
}

/* ---------------------------------------------------------------- painel --- */

/** A edição manda o número; o sinal, a seta e a cor são desenhados aqui. */
function variacao(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  const sinal = v > 0 ? "sobe" : v < 0 ? "desce" : "igual";
  const seta = v > 0 ? "▲" : v < 0 ? "▼" : "→";
  return `<span class="var" data-sinal="${sinal}">${seta} ${Math.abs(v).toFixed(2).replace(".", ",")}%</span>`;
}

const bloco = (titulo, corpo) =>
  corpo ? `<section class="bloco"><span class="rotulo">${titulo}</span>${corpo}</section>` : "";

const linhaCotacao = (l) => `<tr>
  <td class="nome">${esc(l.nome)}</td>
  <td class="num">${esc(l.valor || "")}</td>
  <td class="num">${variacao(l.variacao)}</td>
  <td class="leitura">${esc(l.leitura || "")}</td>
</tr>`;

const tem = (v) => v !== null && v !== undefined && v !== "";

/** Cada bloco só aparece se a edição o trouxer — o painel todo é opcional. */
function desenharPainel(p) {
  if (!p || typeof p !== "object") return "";
  let html = "";

  if (p.indices) {
    html += bloco("Índices", `<table class="tabela">${p.indices.map(linhaCotacao).join("")}</table>`);
  }

  if (p.accoes) {
    html += bloco("Ações", `<table class="tabela">${p.accoes.map(linhaCotacao).join("")}</table>`);
  }

  if (p.carteira || p.destaque) {
    let corpo = "";
    if (p.destaque) {
      const d = p.destaque;
      corpo += `<div class="destaque">
        <div class="topo">
          <div>
            <div class="tick">${esc(d.nome)}</div>
            ${d.descricao ? `<div class="desc">${esc(d.descricao)}</div>` : ""}
          </div>
          <div style="text-align:right">
            ${variacao(d.variacao)}
            ${d.valor ? `<div class="desc">${esc(d.valor)}</div>` : ""}
          </div>
        </div>
        ${d.texto ? `<p class="texto">${esc(d.texto)}</p>` : ""}
      </div>`;
    }
    if (p.carteira) corpo += `<table class="tabela">${p.carteira.map(linhaCotacao).join("")}</table>`;
    html += bloco("Carteira", corpo);
  }

  html += avaliacaoHTML(p, "Leitura de mercado");

  html += geopoliticaHTML(p.geopolitica);

  return html ? `<div class="painel">${html}</div>` : "";
}

/** Oportunidades, riscos e veredicto — as duas metades do painel têm os seus. */
function avaliacaoHTML(o, titulo) {
  let html = "";

  if (o.oportunidades || o.riscos) {
    const coluna = (rotulo, itens, tom) =>
      itens
        ? `<div><span class="rotulo">${rotulo}</span>
             <ul class="lista" data-tom="${tom}">${itens.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
           </div>`
        : "";
    html += bloco(
      titulo,
      `<div class="duas">${coluna("Oportunidades", o.oportunidades, "bom")}${coluna("Riscos", o.riscos, "mau")}</div>`
    );
  }

  if (o.veredicto) {
    const v = o.veredicto;
    html += bloco(
      "Veredicto",
      `<div class="veredicto" data-tom="${esc(v.tom)}">
        ${v.titulo ? `<div class="tom">${esc(v.titulo)}</div>` : ""}
        <p>${esc(v.texto)}</p>
      </div>`
    );
  }

  return html;
}

function geopoliticaHTML(g) {
  if (!g || typeof g !== "object") return "";
  let html = "";

  if (g.risco) {
    const r = g.risco;
    const setas = { sobe: "▲", desce: "▼", estavel: "→" };
    let corpo = "";
    if (tem(r.indice)) {
      corpo += `<div class="medidor">
          <span class="valor">${r.indice}</span>
          <span class="de">/ 100${r.nivel ? ` · ${esc(r.nivel)}` : ""}${r.tendencia ? ` ${setas[r.tendencia]}` : ""}</span>
        </div>
        <div class="medidor-barra" data-alto="${r.indice >= 61 ? 1 : 0}"><i style="width:${r.indice}%"></i></div>`;
    }
    const campos = [
      ["Conflitos ativos", r.conflitos],
      ["Alertas críticos", r.alertas],
      ["Focos", r.hotspots],
      ["Mais expostos", r.expostos],
    ].filter(([, v]) => tem(v));
    if (campos.length) {
      corpo += `<div class="grelha">${campos
        .map(([k, v]) => `<div><span>${k}</span><span>${esc(String(v))}</span></div>`)
        .join("")}</div>`;
    }
    html += bloco("Risco global", corpo);
  }

  if (g.alertas) {
    html += bloco(
      "Do dia",
      `<ul class="alertas">${g.alertas
        .map((a) => `<li data-nivel="${esc(a.nivel)}">${esc(a.texto)}</li>`)
        .join("")}</ul>`
    );
  }

  if (g.conflitos) {
    html += bloco(
      "Teatros",
      `<table class="tabela">${g.conflitos
        .map(
          (c) => `<tr>
            <td class="nome">${esc(c.nome)}</td>
            <td class="num">${esc(c.probabilidade || "")}</td>
            <td class="leitura">${esc(c.situacao || "")}</td>
          </tr>`
        )
        .join("")}</table>`
    );
  }

  html += avaliacaoHTML(g, "Leitura geopolítica");

  if (g.impacto_carteira) {
    const sinais = { positivo: "▲", neutro: "→", negativo: "▼" };
    html += bloco(
      "Impacto na carteira",
      `<table class="tabela">${g.impacto_carteira
        .map(
          (i) => `<tr>
            <td class="nome">${esc(i.nome)}</td>
            <td class="num"><span class="var" data-sinal="${
              i.sentido === "positivo" ? "sobe" : i.sentido === "negativo" ? "desce" : "igual"
            }">${sinais[i.sentido]}</span></td>
            <td class="leitura">${esc(i.justificacao || "")}</td>
          </tr>`
        )
        .join("")}</table>`
    );
  }

  return html ? `<div class="metade"><span class="rotulo divisor">Geopolítica</span>${html}</div>` : "";
}

/** Onde vai o curso de IA. */
function desenharProgresso(pr) {
  if (!pr || typeof pr !== "object") return "";
  const selos = [];
  if (tem(pr.dia)) selos.push(`Dia <b>${pr.dia}</b>`);
  if (pr.nivel) selos.push(`<b>${esc(pr.nivel)}</b>`);
  if (tem(pr.percentagem)) selos.push(`<b>${pr.percentagem}%</b> do curso`);
  if (tem(pr.leitura_min)) selos.push(`<b>${pr.leitura_min}</b> min`);
  return selos.length
    ? `<div class="progresso">${selos.map((s) => `<span class="selo">${s}</span>`).join("")}</div>`
    : "";
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
  // Guarda de que módulo veio, para o "voltar" não atirar sempre para Notícias.
  estado.moduloOrigem = MODULO[edicao.rotina] || "noticias";
  $("#btn-voltar-edicao").textContent =
    estado.moduloOrigem === "aprendizagem" ? "← Aprendizagem" : "← Notícias";
  const cor = COR[edicao.rotina];

  cabecalho.innerHTML = `
    <p class="rotulo" style="color:${cor};margin-top:1.4rem">${esc(NOMES[edicao.rotina] || edicao.rotina)}</p>
    <h1 class="titulo-grande">${esc(edicao.titulo)}</h1>
    <p class="linha-meta rotulo">${esc(porExtenso(edicao.data))} · ${edicao.itens.length} temas</p>
    ${desenharProgresso(edicao.progresso)}
    <p class="resumo">${esc(edicao.resumo)}</p>
    <div style="--marcador:${cor}">${desenharPainel(edicao.painel)}</div>`;

  itens.innerHTML = edicao.itens
    .map((item, i) => {
      const partes = String(item.texto).split(/Porque interessa:\s*/i);
      const corpo = partes[0].trim();
      // O rótulo já diz "Porque interessa", por isso a frase começa em maiúscula.
      const porque = partes[1]?.trim().replace(/^./, (c) => c.toUpperCase());
      const marca = [
        tem(item.capitulo) ? `Cap. ${item.capitulo}` : "",
        item.rubrica ? esc(item.rubrica) : "",
      ].filter(Boolean);
      return `<article class="verbete" style="--marcador:${cor}">
        <div class="verbete-meta">
          ${marca.length ? `<span class="capitulo rotulo">${marca.join(" · ")}</span>` : ""}
          <span class="impacto rotulo" data-nivel="${esc(item.impacto)}">
            <i></i><i></i><i></i> impacto ${esc(item.impacto)}
          </span>
        </div>
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

$("#btn-voltar-edicao").addEventListener("click", () => irPara(estado.moduloOrigem || "noticias"));

/* ---------------------------------------------------------------- quotes --- */

/* Colectânea fixa: roda pelo dia do ano, funciona offline e não gasta corridas.
   Todas de obras publicadas e identificadas — se acrescentares, mantém a fonte. */
const QUOTES = [
  ["Não é que tenhamos pouco tempo, é que perdemos muito.", "Séneca, Sobre a Brevidade da Vida"],
  ["Enquanto se adia, a vida passa.", "Séneca, Cartas a Lucílio"],
  ["Nenhum vento é favorável a quem não sabe para que porto se dirige.", "Séneca, Cartas a Lucílio"],
  ["O impedimento à ação faz avançar a ação. O que está no caminho torna-se o caminho.", "Marco Aurélio, Meditações"],
  ["Tens poder sobre a tua mente, não sobre os acontecimentos.", "Marco Aurélio, Meditações"],
  ["A qualidade da tua vida depende da qualidade dos teus pensamentos.", "Marco Aurélio, Meditações"],
  ["Ninguém escreve um livro só; escreve-o com tudo o que leu.", "Montaigne, Ensaios"],
  ["O primeiro princípio é não te enganares a ti próprio — e tu és a pessoa mais fácil de enganar.", "Richard Feynman"],
  ["A ciência é uma forma de não nos enganarmos.", "Richard Feynman"],
  ["Não sobrevive a espécie mais forte, mas a que melhor se adapta à mudança.", "atribuído a Charles Darwin"],
  ["A ignorância gera mais confiança do que o conhecimento.", "Charles Darwin, A Origem do Homem"],
  ["Ler é conversar com os homens mais sábios de séculos passados.", "Descartes, Discurso do Método"],
  ["Divide cada dificuldade em tantas partes quantas forem possíveis para a resolver.", "Descartes, Discurso do Método"],
  ["Alguns livros devem ser provados, outros engolidos, e poucos mastigados e digeridos.", "Francis Bacon, Ensaios"],
  ["O conhecimento é poder.", "Francis Bacon, Meditationes Sacrae"],
  ["Aquele que tem um porquê para viver suporta quase qualquer como.", "Nietzsche, Crepúsculo dos Ídolos"],
  ["Os limites da minha linguagem são os limites do meu mundo.", "Wittgenstein, Tractatus"],
  ["Aquilo de que não se pode falar, deve-se calar.", "Wittgenstein, Tractatus"],
  ["Uma vida não examinada não vale a pena ser vivida.", "Sócrates, em Apologia de Platão"],
  ["Só sei que nada sei.", "atribuído a Sócrates, a partir de Platão"],
  ["Somos aquilo que fazemos repetidamente.", "Will Durant, a resumir Aristóteles"],
  ["O todo é maior do que a soma das partes.", "Aristóteles, Metafísica"],
  ["Aprender sem pensar é trabalho perdido; pensar sem aprender é perigoso.", "Confúcio, Analectos"],
  ["Não te preocupes por não seres conhecido; preocupa-te por não seres digno de o ser.", "Confúcio, Analectos"],
];

function desenharQuote() {
  const inicio = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const dia = Math.floor((Date.now() - inicio) / DIA);
  const [texto, fonte] = QUOTES[dia % QUOTES.length];
  $("#quote").innerHTML = `<blockquote>“${esc(texto)}”</blockquote>
    <figcaption>${esc(fonte)}</figcaption>`;
}

/* ---------------------------------------------------------------- livros --- */

const ESTADOS_LIVRO = { a_ler: "A ler", lido: "Lido", recomendado: "Recomendado" };

let livroAberto = null;

function desenharLivros() {
  const procura = $("#procura-livros").value.trim().toLowerCase();
  const lista = vivos("livros")
    .filter((l) => !procura || `${l.titulo} ${l.autor} ${l.resumo}`.toLowerCase().includes(procura))
    .sort((a, b) => b.atualizado_em - a.atualizado_em);

  $("#lista-livros").innerHTML =
    lista
      .map(
        (l) => `<button class="livro" data-livro="${esc(l.id)}">
          <span class="rotulo estado-livro" data-estado="${esc(l.estado)}">${esc(
          ESTADOS_LIVRO[l.estado] || l.estado
        )}</span>
          <h4>${esc(l.titulo || "Sem título")}</h4>
          ${l.autor ? `<p>${esc(l.autor)}</p>` : ""}
          ${l.resumo ? `<p>${esc(l.resumo.slice(0, 120))}${l.resumo.length > 120 ? "…" : ""}</p>` : ""}
        </button>`
      )
      .join("") ||
    vazio(
      procura ? "Nada encontrado" : "Ainda sem livros",
      procura
        ? "Não há livros com esse termo."
        : "Acrescenta o primeiro: título, autor e o que quiseres guardar da leitura."
    );
}

function abrirLivro(livro) {
  livroAberto = livro || {
    id: id(),
    titulo: "",
    autor: "",
    estado: "a_ler",
    resumo: "",
    criado_em: Date.now(),
    apagado: false,
  };
  $("#livro-rotulo").textContent = livro ? "Editar livro" : "Novo livro";
  $("#livro-titulo").value = livroAberto.titulo;
  $("#livro-autor").value = livroAberto.autor;
  $("#livro-resumo").value = livroAberto.resumo;
  $("#livro-apagar").style.display = livro ? "" : "none";
  marcarEstadoLivro(livroAberto.estado);
  $("#folha-livro").showModal();
}

function marcarEstadoLivro(valor) {
  livroAberto.estado = valor;
  document
    .querySelectorAll("[data-livro-estado]")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.livroEstado === valor ? "true" : "false"));
}

document
  .querySelectorAll("[data-livro-estado]")
  .forEach((b) => b.addEventListener("click", () => marcarEstadoLivro(b.dataset.livroEstado)));

$("#btn-livro-novo").addEventListener("click", () => abrirLivro(null));
$("#procura-livros").addEventListener("input", desenharLivros);

$("#lista-livros").addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-livro]");
  if (alvo) abrirLivro(estado.biblioteca.livros[alvo.dataset.livro]);
});

$("#livro-cancelar").addEventListener("click", () => $("#folha-livro").close());

$("#livro-guardar").addEventListener("click", () => {
  livroAberto.titulo = $("#livro-titulo").value.trim();
  livroAberto.autor = $("#livro-autor").value.trim();
  livroAberto.resumo = $("#livro-resumo").value;
  if (!livroAberto.titulo) return;
  alterar("livros", livroAberto);
  $("#folha-livro").close();
  desenharLivros();
});

$("#livro-apagar").addEventListener("click", () => {
  livroAberto.apagado = true;
  alterar("livros", livroAberto);
  $("#folha-livro").close();
  desenharLivros();
});

/* ----------------------------------------------------------------- tema --- */

/** "sistema" é a ausência do atributo: assim o @media volta a mandar. */
function aplicarTema(tema) {
  if (tema === "sistema") delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
  localStorage.setItem("venera:tema", tema);

  // A barra do Safari segue o fundo real, seja ele qual for.
  const fundo = getComputedStyle(document.documentElement).getPropertyValue("--tinta").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", fundo);

  document
    .querySelectorAll("[data-tema-opcao]")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.temaOpcao === tema ? "true" : "false"));
}

document.querySelectorAll("[data-tema-opcao]").forEach((b) =>
  b.addEventListener("click", () => aplicarTema(b.dataset.temaOpcao))
);

aplicarTema(localStorage.getItem("venera:tema") || "sistema");

/* ------------------------------------------------------------ definições --- */

const avisoDef = (texto) => ($("#def-aviso").textContent = texto);

/** A cópia leva os apagados de propósito: senão restaurar ressuscitava-os. */
const copiaDeSeguranca = () => ({
  formato: "venera/1",
  exportado_em: new Date().toISOString(),
  notas: Object.values(estado.biblioteca.notas),
  cartoes: Object.values(estado.biblioteca.cartoes),
  livros: Object.values(estado.biblioteca.livros || {}),
});

/**
 * No iPhone é a partilha que abre o "Guardar em Ficheiros"; o download só
 * funciona bem no computador. Tenta a partilha e cai para o download.
 */
async function entregarFicheiro(nome, texto, tipo) {
  const ficheiro = new File([texto], nome, { type: tipo });
  if (navigator.canShare?.({ files: [ficheiro] })) {
    try {
      await navigator.share({ files: [ficheiro], title: nome });
      return "guardado";
    } catch (erro) {
      if (erro.name === "AbortError") return "cancelado";
    }
  }
  const url = URL.createObjectURL(ficheiro);
  const ligacao = document.createElement("a");
  ligacao.href = url;
  ligacao.download = nome;
  ligacao.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "descarregado";
}

const carimbo = () => new Date().toISOString().slice(0, 10);

async function exportarJson() {
  const r = await entregarFicheiro(
    `venera-${carimbo()}.json`,
    JSON.stringify(copiaDeSeguranca(), null, 2),
    "application/json"
  );
  avisoDef(r === "cancelado" ? "Cópia cancelada." : `Cópia ${r}.`);
}

async function exportarMarkdown() {
  const linhas = [`# Venera — ${carimbo()}`, ""];

  const notas = vivos("notas").sort((a, b) => b.atualizado_em - a.atualizado_em);
  if (notas.length) {
    linhas.push("## Notas", "");
    for (const n of notas) {
      linhas.push(`### ${n.titulo || "Sem título"}`, "");
      if (n.origem?.titulo) linhas.push(`*De: ${n.origem.titulo}*`, "");
      linhas.push(n.texto || "", "");
    }
  }

  const cartoes = vivos("cartoes").sort((a, b) => a.criado_em - b.criado_em);
  if (cartoes.length) {
    linhas.push("## Cartões", "");
    for (const c of cartoes) {
      linhas.push(`- **${c.frente}**`, `  ${c.verso}`, "");
    }
  }

  const r = await entregarFicheiro(`venera-${carimbo()}.md`, linhas.join("\n"), "text/markdown");
  avisoDef(r === "cancelado" ? "Exportação cancelada." : `Ficheiro ${r}.`);
}

async function importar(ficheiro) {
  let dados;
  try {
    dados = JSON.parse(await ficheiro.text());
  } catch {
    return avisoDef("Não consegui ler o ficheiro: não é JSON válido.");
  }
  if (!dados || !TIPOS.some((t) => Array.isArray(dados[t]))) {
    return avisoDef("Isto não parece uma cópia da Venera.");
  }

  let novos = 0;
  let recentes = 0;
  let ignorados = 0;
  for (const tipo of TIPOS) {
    for (const item of dados[tipo] || []) {
      if (!item?.id || typeof item.id !== "string") {
        ignorados++;
        continue;
      }
      const atual = estado.biblioteca[tipo][item.id];
      if (!atual) novos++;
      else if ((item.atualizado_em || 0) > (atual.atualizado_em || 0)) recentes++;
      else {
        ignorados++;
        continue;
      }
      // Não passa por alterar(): esse carimba a hora, e uma cópia antiga
      // passaria a parecer a versão mais recente. Guarda a hora original.
      estado.biblioteca[tipo][item.id] = item;
      estado.sujos.add(`${tipo}:${item.id}`);
    }
  }

  gravarLocal();
  agendarSync();
  desenharDefinicoes();
  avisoDef(`${novos} novos, ${recentes} atualizados, ${ignorados} já estavam em dia.`);
}

async function limparCache() {
  for (const nome of await caches.keys()) await caches.delete(nome);
  const registos = await navigator.serviceWorker?.getRegistrations?.();
  for (const r of registos || []) await r.unregister();
  avisoDef("Cache limpa. Fecha e volta a abrir a app.");
}

function esquecerChave() {
  localStorage.removeItem("venera:chave");
  estado.chave = "";
  irPara("chave");
}

function desenharDefinicoes() {
  const notas = vivos("notas").length;
  const cartoes = vivos("cartoes");
  const devidos = cartoes.filter((c) => c.sm2.proxima <= Date.now()).length;
  const bytes = new Blob([JSON.stringify(estado.biblioteca)]).size;

  const par = (k, v) => `<div><span>${k}</span><span>${esc(String(v))}</span></div>`;

  $("#def-numeros").innerHTML = [
    par("Notas", notas),
    par("Cartões", cartoes.length),
    par("A rever hoje", devidos),
    par("Tamanho", `${(bytes / 1024).toFixed(1)} kB`),
  ].join("");

  $("#def-sync").innerHTML = [
    par("Estado", $("#estado").textContent),
    par("Por enviar", estado.sujos.size),
    par(
      "Última",
      estado.desde ? new Date(estado.desde).toLocaleString("pt-PT") : "ainda nenhuma"
    ),
  ].join("");
}

$("#def-exportar").addEventListener("click", exportarJson);
$("#def-markdown").addEventListener("click", exportarMarkdown);
$("#def-importar").addEventListener("click", () => $("#def-ficheiro").click());
$("#def-ficheiro").addEventListener("change", (e) => {
  const ficheiro = e.target.files?.[0];
  if (ficheiro) importar(ficheiro);
  e.target.value = "";
});
$("#def-sincronizar").addEventListener("click", async () => {
  await sincronizar();
  desenharDefinicoes();
});
$("#def-cache").addEventListener("click", limparCache);
$("#def-esquecer").addEventListener("click", esquecerChave);

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
    irPara("noticias");
    sincronizar();
  } catch {
    $("#aviso-chave").textContent = "Chave recusada. Confirma que copiaste a chave da app, não a das rotinas.";
  } finally {
    $("#btn-chave").disabled = false;
  }
}

contarRevisao();
if (estado.chave) {
  irPara("noticias");
  sincronizar();
} else {
  irPara("chave");
  marcarEstado("por ligar", "parado");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
