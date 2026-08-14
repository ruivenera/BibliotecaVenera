/**
 * Venera — biblioteca de estudo.
 *
 * Um só Worker faz três coisas:
 *   1. serve a PWA (ficheiros em /public, via binding ASSETS)
 *   2. recebe as edições diárias das routines    → POST /api/ingest  (INGEST_TOKEN)
 *   3. serve e sincroniza a biblioteca para a app → /api/*           (APP_TOKEN)
 *
 * Dois tokens com propósitos distintos: as routines só escrevem edições,
 * a app só lê edições e mexe nas notas e cartões.
 */

const ROTINAS = {
  "financas-geopolitica": "Finanças & Geopolítica",
  "inteligencia-artificial": "Inteligência Artificial",
};
const CHAVES = Object.keys(ROTINAS);

const MAX_ITENS = 20;
const HISTORICO = 90; // dias de edições guardados por rotina
const MAX_BODY = 512 * 1024;
const MAX_BIBLIOTECA = 4 * 1024 * 1024; // travão de segurança do valor em KV

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

const resposta = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });

/* ------------------------------------------------------------------ auth --- */

function confere(request, esperado) {
  if (!esperado) return false;
  const cabecalho = request.headers.get("authorization") || "";
  const enviado = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
  if (enviado.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= enviado.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------- validação --- */

const texto = (v, min, max) =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

function validarEdicao(p) {
  const erros = [];
  if (!p || typeof p !== "object") return ["payload tem de ser um objeto JSON"];
  if (!CHAVES.includes(p.rotina)) erros.push(`rotina desconhecida (usa: ${CHAVES.join(", ")})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data || "")) erros.push("data tem de ser AAAA-MM-DD");
  if (!texto(p.titulo, 3, 200)) erros.push("titulo inválido");
  if (!texto(p.resumo, 20, 2000)) erros.push("resumo inválido");

  if (!Array.isArray(p.itens) || p.itens.length < 1 || p.itens.length > MAX_ITENS) {
    erros.push(`itens tem de ser uma lista de 1 a ${MAX_ITENS} elementos`);
    return erros;
  }
  p.itens.forEach((item, i) => {
    if (!texto(item?.titulo, 3, 200)) erros.push(`item ${i}: titulo inválido`);
    if (!texto(item?.texto, 40, 4000)) erros.push(`item ${i}: texto demasiado curto ou longo`);
    if (!["alto", "medio", "baixo"].includes(item?.impacto))
      erros.push(`item ${i}: impacto tem de ser alto|medio|baixo`);
    if (!Array.isArray(item?.fontes) || item.fontes.length < 1) {
      erros.push(`item ${i}: precisa de pelo menos uma fonte`);
      return;
    }
    item.fontes.forEach((f, j) => {
      if (!texto(f?.titulo, 2, 120)) erros.push(`item ${i} fonte ${j}: titulo inválido`);
      if (!/^https:\/\/\S+$/.test(f?.url || ""))
        erros.push(`item ${i} fonte ${j}: url tem de ser https`);
    });
  });
  return erros;
}

/* ---------------------------------------------------------------- painel --- */

/**
 * O painel é opcional e nunca faz falhar a publicação: ao contrário dos campos
 * obrigatórios, o que vier torto cai fora em silêncio. A edição é o que interessa;
 * o painel é o resumo por cima dela, e mais vale publicar sem ele do que não publicar.
 */

const frase = (v, max) => String(v ?? "").trim().slice(0, max);

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const limite = (v, min, max) => {
  const n = numero(v);
  return n === null ? null : Math.min(Math.max(n, min), max);
};

/** Linhas de índices e de carteira têm a mesma forma. */
const cotacoes = (lista) =>
  (Array.isArray(lista) ? lista : [])
    .map((l) => {
      const nome = frase(l?.nome, 40);
      if (!nome) return null;
      const linha = {
        nome,
        valor: frase(l?.valor, 30),
        variacao: numero(l?.variacao),
        leitura: frase(l?.leitura, 160),
      };
      // Fechos recentes, para o gráfico ter forma logo no primeiro dia.
      const serie = (Array.isArray(l?.serie) ? l.serie : []).map(numero).filter((n) => n !== null);
      if (serie.length >= 3) linha.serie = serie.slice(-30);
      return linha;
    })
    .filter(Boolean)
    .slice(0, 12);

/**
 * Imagem do tema. Só passa se for https e de um sítio de licença clara — o
 * crédito é obrigatório porque a app tem de o mostrar ao lado da imagem.
 */
const SITIOS_IMAGEM = /^(upload\.wikimedia\.org|commons\.wikimedia\.org|images\.unsplash\.com)$/i;

function limparImagem(img) {
  const url = frase(img?.url, 600);
  const credito = frase(img?.credito, 160);
  if (!url || !credito) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" || !SITIOS_IMAGEM.test(hostname)) return null;
  } catch {
    return null;
  }
  return { url, credito };
}

const textos = (lista, max) =>
  (Array.isArray(lista) ? lista : [])
    .map((t) => frase(t, 240))
    .filter(Boolean)
    .slice(0, max);

function limparPainel(p) {
  if (!p || typeof p !== "object") return null;
  const painel = {};

  const indices = cotacoes(p.indices);
  if (indices.length) painel.indices = indices;

  const accoes = cotacoes(p.accoes);
  if (accoes.length) painel.accoes = accoes;

  const carteira = cotacoes(p.carteira);
  if (carteira.length) painel.carteira = carteira;

  if (frase(p.destaque?.nome, 40)) {
    painel.destaque = {
      nome: frase(p.destaque.nome, 40),
      descricao: frase(p.destaque.descricao, 80),
      valor: frase(p.destaque.valor, 30),
      variacao: numero(p.destaque.variacao),
      texto: frase(p.destaque.texto, 600),
    };
  }

  if (p.risco && typeof p.risco === "object") {
    const risco = {
      indice: limite(p.risco.indice, 0, 100),
      nivel: frase(p.risco.nivel, 30),
      tendencia: ["sobe", "desce", "estavel"].includes(p.risco.tendencia) ? p.risco.tendencia : "",
      conflitos: limite(p.risco.conflitos, 0, 999),
      alertas: limite(p.risco.alertas, 0, 999),
      hotspots: frase(p.risco.hotspots, 160),
      expostos: frase(p.risco.expostos, 160),
    };
    if (risco.indice !== null || risco.nivel) painel.risco = risco;
  }

  avaliacao(p, painel);

  const geo = limparGeopolitica(p.geopolitica);
  if (geo) painel.geopolitica = geo;

  return Object.keys(painel).length ? painel : null;
}

/** Oportunidades, riscos e veredicto: as duas metades do painel têm os seus. */
function avaliacao(origem, alvo) {
  const oportunidades = textos(origem.oportunidades, 8);
  if (oportunidades.length) alvo.oportunidades = oportunidades;

  const riscos = textos(origem.riscos, 8);
  if (riscos.length) alvo.riscos = riscos;

  const veredicto = frase(origem.veredicto?.texto, 800);
  if (veredicto) {
    alvo.veredicto = {
      tom: ["alta", "baixa", "neutro"].includes(origem.veredicto.tom) ? origem.veredicto.tom : "neutro",
      titulo: frase(origem.veredicto.titulo, 60),
      texto: veredicto,
    };
  }
}

function limparGeopolitica(g) {
  if (!g || typeof g !== "object") return null;
  const geo = {};

  if (g.risco && typeof g.risco === "object") {
    const risco = {
      indice: limite(g.risco.indice, 0, 100),
      nivel: frase(g.risco.nivel, 30),
      tendencia: ["sobe", "desce", "estavel"].includes(g.risco.tendencia) ? g.risco.tendencia : "",
      conflitos: limite(g.risco.conflitos, 0, 999),
      alertas: limite(g.risco.alertas, 0, 999),
      hotspots: frase(g.risco.hotspots, 160),
      expostos: frase(g.risco.expostos, 160),
    };
    if (risco.indice !== null || risco.nivel) geo.risco = risco;
  }

  const alertas = (Array.isArray(g.alertas) ? g.alertas : [])
    .map((a) => {
      const texto = frase(a?.texto, 240);
      return texto
        ? { nivel: ["critico", "elevado", "moderado"].includes(a.nivel) ? a.nivel : "moderado", texto }
        : null;
    })
    .filter(Boolean)
    .slice(0, 8);
  if (alertas.length) geo.alertas = alertas;

  const conflitos = (Array.isArray(g.conflitos) ? g.conflitos : [])
    .map((c) => {
      const nome = frase(c?.nome, 60);
      return nome
        ? { nome, probabilidade: frase(c?.probabilidade, 20), situacao: frase(c?.situacao, 160) }
        : null;
    })
    .filter(Boolean)
    .slice(0, 12);
  if (conflitos.length) geo.conflitos = conflitos;

  const impacto = (Array.isArray(g.impacto_carteira) ? g.impacto_carteira : [])
    .map((i) => {
      const nome = frase(i?.nome, 40);
      return nome
        ? {
            nome,
            sentido: ["positivo", "neutro", "negativo"].includes(i.sentido) ? i.sentido : "neutro",
            justificacao: frase(i?.justificacao, 200),
          }
        : null;
    })
    .filter(Boolean)
    .slice(0, 12);
  if (impacto.length) geo.impacto_carteira = impacto;

  avaliacao(g, geo);

  return Object.keys(geo).length ? geo : null;
}

/** Capítulo, rubrica, tópicos e hora são opcionais; o resto já foi validado. */
function limparItem(i) {
  const item = { ...i };

  const capitulo = limite(i.capitulo, 1, 99);
  if (capitulo === null) delete item.capitulo;
  else item.capitulo = capitulo;

  const rubrica = frase(i.rubrica, 40);
  if (rubrica) item.rubrica = rubrica;
  else delete item.rubrica;

  // A que metade pertence. Explícito, porque a rubrica passou a ser a região
  // ("Médio Oriente") e já não dava para adivinhar pelo nome.
  if (["mercado", "geopolitica"].includes(i.modulo)) item.modulo = i.modulo;
  else delete item.modulo;

  // Os tópicos do resumo rápido, à cabeça da leitura.
  const pontos = textos(i.pontos, 6);
  if (pontos.length) item.pontos = pontos;
  else delete item.pontos;

  const imagem = limparImagem(i.imagem);
  if (imagem) item.imagem = imagem;
  else delete item.imagem;

  // Hora do acontecimento, para a app poder dizer "há 2 horas".
  const quando = Date.parse(i.publicado_em);
  if (Number.isFinite(quando)) item.publicado_em = new Date(quando).toISOString();
  else delete item.publicado_em;

  return item;
}

function limparProgresso(p) {
  if (!p || typeof p !== "object") return null;
  const progresso = {
    dia: limite(p.dia, 0, 100000),
    nivel: frase(p.nivel, 40),
    percentagem: limite(p.percentagem, 0, 100),
    leitura_min: limite(p.leitura_min, 0, 600),
  };
  return progresso.dia !== null || progresso.nivel ? progresso : null;
}

/* --------------------------------------------------------------- edições --- */

async function ingerir(request, env) {
  if (!confere(request, env.INGEST_TOKEN)) return resposta({ erro: "nao_autorizado" }, 401);

  const bruto = await request.text();
  if (bruto.length > MAX_BODY) return resposta({ erro: "payload_demasiado_grande" }, 413);

  let payload;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return resposta({ erro: "json_invalido" }, 400);
  }

  const erros = validarEdicao(payload);
  if (erros.length) return resposta({ erro: "validacao_falhou", detalhes: erros }, 422);

  const edicao = { ...payload, recebido_em: new Date().toISOString() };

  edicao.itens = payload.itens.map(limparItem);

  // Limpos, não validados: um bloco torto sai da edição em vez de a recusar.
  const painel = limparPainel(payload.painel);
  const progresso = limparProgresso(payload.progresso);
  if (painel) edicao.painel = painel;
  else delete edicao.painel;
  if (progresso) edicao.progresso = progresso;
  else delete edicao.progresso;

  // Mesma rotina + mesmo dia sobrepõe: um re-run não duplica a edição.
  await env.VENERA.put(`edicao:${payload.rotina}:${payload.data}`, JSON.stringify(edicao));

  const chaveIndice = `indice:${payload.rotina}`;
  const anterior = JSON.parse((await env.VENERA.get(chaveIndice)) || "[]");
  const datas = [...new Set([payload.data, ...anterior])].sort().reverse().slice(0, HISTORICO);
  await env.VENERA.put(chaveIndice, JSON.stringify(datas));

  return resposta({
    ok: true,
    rotina: payload.rotina,
    data: payload.data,
    itens: payload.itens.length,
  });
}

const lerIndice = async (env, rotina) =>
  JSON.parse((await env.VENERA.get(`indice:${rotina}`)) || "[]");

async function lerEdicao(env, rotina, data) {
  if (!CHAVES.includes(rotina)) return null;
  if (data === "ultima") {
    const indice = await lerIndice(env, rotina);
    if (!indice.length) return null;
    data = indice[0];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const bruto = await env.VENERA.get(`edicao:${rotina}:${data}`);
  return bruto ? JSON.parse(bruto) : null;
}

async function feed(env) {
  const edicoes = await Promise.all(CHAVES.map((r) => lerEdicao(env, r, "ultima")));
  return resposta({
    gerado_em: new Date().toISOString(),
    rotinas: ROTINAS,
    edicoes: edicoes.filter(Boolean),
    em_falta: CHAVES.filter((_, i) => !edicoes[i]),
  });
}

/** Lombadas da estante: uma por edição, só com o que a capa precisa de mostrar. */
async function estante(env, limite = 40) {
  const porRotina = await Promise.all(
    CHAVES.map(async (rotina) => {
      const datas = (await lerIndice(env, rotina)).slice(0, limite);
      const edicoes = await Promise.all(
        datas.map(async (data) => {
          const e = await lerEdicao(env, rotina, data);
          return e && { rotina, data, titulo: e.titulo, itens: e.itens.length };
        })
      );
      return edicoes.filter(Boolean);
    })
  );
  const lombadas = porRotina.flat().sort((a, b) => (a.data < b.data ? 1 : -1));
  return resposta({ rotinas: ROTINAS, lombadas });
}

/**
 * Série de cada índice ao longo dos últimos dias, para os gráficos da app.
 *
 * Sai das variações diárias, não dos valores: o "valor" vem como texto
 * formatado à portuguesa e não dá para converter com segurança. Encadeando as
 * variações a partir de uma base 100 fica-se com o percurso relativo, que é o
 * que um gráfico destes mostra — e é tudo derivado de números verdadeiros.
 */
async function historico(env, rotina, dias = 14) {
  if (!CHAVES.includes(rotina)) return resposta({ erro: "rotina_desconhecida" }, 404);

  const datas = (await lerIndice(env, rotina)).slice(0, dias).reverse();
  const edicoes = await Promise.all(datas.map((d) => lerEdicao(env, rotina, d)));

  const series = {};
  for (const edicao of edicoes) {
    for (const linha of edicao?.painel?.indices || []) {
      if (typeof linha.variacao !== "number") continue;
      const serie = (series[linha.nome] ||= { pontos: [], base: 100 });
      const anterior = serie.pontos.length ? serie.pontos[serie.pontos.length - 1].nivel : 100;
      serie.pontos.push({
        data: edicao.data,
        variacao: linha.variacao,
        nivel: Number((anterior * (1 + linha.variacao / 100)).toFixed(4)),
      });
    }
  }

  return resposta({ rotina, dias: datas.length, series });
}

/* ----------------------------------------------------------- biblioteca --- */

const agora = () => Date.now();

function limparNota(n) {
  if (!n?.id || typeof n.id !== "string" || n.id.length > 64) return null;
  return {
    id: n.id,
    titulo: String(n.titulo || "").slice(0, 200),
    texto: String(n.texto || "").slice(0, 20000),
    origem: n.origem && typeof n.origem === "object" ? n.origem : null,
    criado_em: Number(n.criado_em) || agora(),
    atualizado_em: Number(n.atualizado_em) || agora(),
    apagado: !!n.apagado,
  };
}

function limparCartao(c) {
  if (!c?.id || typeof c.id !== "string" || c.id.length > 64) return null;
  const sm2 = c.sm2 || {};
  return {
    id: c.id,
    frente: String(c.frente || "").slice(0, 1000),
    verso: String(c.verso || "").slice(0, 4000),
    origem: c.origem && typeof c.origem === "object" ? c.origem : null,
    criado_em: Number(c.criado_em) || agora(),
    atualizado_em: Number(c.atualizado_em) || agora(),
    apagado: !!c.apagado,
    sm2: {
      intervalo: Number(sm2.intervalo) || 0,
      facilidade: Number(sm2.facilidade) || 2.5,
      repeticoes: Number(sm2.repeticoes) || 0,
      proxima: Number(sm2.proxima) || agora(),
      revisoes: Number(sm2.revisoes) || 0,
    },
  };
}

function limparLivro(l) {
  if (!l?.id || typeof l.id !== "string" || l.id.length > 64) return null;
  return {
    id: l.id,
    titulo: String(l.titulo || "").slice(0, 200),
    autor: String(l.autor || "").slice(0, 120),
    estado: ["a_ler", "lido", "recomendado"].includes(l.estado) ? l.estado : "a_ler",
    resumo: String(l.resumo || "").slice(0, 40000),
    criado_em: Number(l.criado_em) || agora(),
    atualizado_em: Number(l.atualizado_em) || agora(),
    apagado: !!l.apagado,
  };
}

/**
 * Área de aprendizagem: um tema grande do Rui, com os seus subtemas. O progresso
 * não é um campo — sai da conta dos subtemas feitos, para não haver duas verdades.
 */
function limparArea(a) {
  if (!a?.id || typeof a.id !== "string" || a.id.length > 64) return null;
  return {
    id: a.id,
    nome: String(a.nome || "").slice(0, 80),
    sigla: String(a.sigla || "").slice(0, 4).toUpperCase(),
    cor: ["latao", "indigo", "sobe", "rust"].includes(a.cor) ? a.cor : "latao",
    temas: (Array.isArray(a.temas) ? a.temas : [])
      .map((t) => ({ nome: String(t?.nome || "").slice(0, 120), feito: !!t?.feito }))
      .filter((t) => t.nome)
      .slice(0, 200),
    criado_em: Number(a.criado_em) || agora(),
    atualizado_em: Number(a.atualizado_em) || agora(),
    apagado: !!a.apagado,
  };
}

const TIPOS = { notas: limparNota, cartoes: limparCartao, livros: limparLivro, areas: limparArea };

/**
 * Sincronização por diferenças. O cliente manda o que mudou desde a última vez
 * e recebe tudo o que mudou no servidor desde então. Ganha a versão com
 * atualizado_em mais recente — com um só utilizador chega, e evita conflitos.
 */
async function sincronizar(request, env) {
  if (!confere(request, env.APP_TOKEN)) return resposta({ erro: "nao_autorizado" }, 401);

  const bruto = await request.text();
  if (bruto.length > MAX_BODY) return resposta({ erro: "payload_demasiado_grande" }, 413);

  let payload;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return resposta({ erro: "json_invalido" }, 400);
  }

  const desde = Number(payload.desde) || 0;
  const biblioteca = JSON.parse((await env.VENERA.get("biblioteca")) || "{}");
  // Bibliotecas gravadas antes dos livros não trazem a gaveta: cria-a à chegada.
  for (const tipo of Object.keys(TIPOS)) biblioteca[tipo] ||= {};

  let mudou = false;
  for (const tipo of Object.keys(TIPOS)) {
    for (const cru of payload[tipo] || []) {
      const item = TIPOS[tipo](cru);
      if (!item) continue;
      const atual = biblioteca[tipo][item.id];
      if (!atual || item.atualizado_em > (atual.atualizado_em || 0)) {
        biblioteca[tipo][item.id] = item;
        mudou = true;
      }
    }
  }

  if (mudou) {
    const serializado = JSON.stringify(biblioteca);
    if (serializado.length > MAX_BIBLIOTECA) return resposta({ erro: "biblioteca_cheia" }, 507);
    await env.VENERA.put("biblioteca", serializado);
  }

  const alterados = (tipo) =>
    Object.values(biblioteca[tipo]).filter((i) => (i.atualizado_em || 0) > desde);

  const devolver = { agora: agora() };
  for (const tipo of Object.keys(TIPOS)) devolver[tipo] = alterados(tipo);
  return resposta(devolver);
}

/* ---------------------------------------------------------------- router --- */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const caminho = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const partes = caminho.split("/").filter(Boolean);

    if (partes[0] !== "api") return env.ASSETS.fetch(request);

    if (request.method === "POST" && caminho === "/api/ingest") return ingerir(request, env);
    if (request.method === "POST" && caminho === "/api/sync") return sincronizar(request, env);

    if (request.method === "GET") {
      // Tudo o que a app lê passa pelo APP_TOKEN, incluindo o teste da chave.
      if (!confere(request, env.APP_TOKEN)) return resposta({ erro: "nao_autorizado" }, 401);

      if (caminho === "/api/chave") return resposta({ ok: true, rotinas: ROTINAS });
      if (caminho === "/api/feed") return feed(env);
      if (caminho === "/api/estante") return estante(env);

      if (partes[1] === "historico" && partes.length === 3) return historico(env, partes[2]);

      if (partes[1] === "indice" && partes.length === 3) {
        if (!CHAVES.includes(partes[2])) return resposta({ erro: "rotina_desconhecida" }, 404);
        return resposta({ rotina: partes[2], datas: await lerIndice(env, partes[2]) });
      }
      if (partes[1] === "edicao" && partes.length === 4) {
        const edicao = await lerEdicao(env, partes[2], partes[3]);
        return edicao ? resposta(edicao) : resposta({ erro: "edicao_nao_encontrada" }, 404);
      }
    }

    return resposta({ erro: "nao_encontrado" }, 404);
  },
};
