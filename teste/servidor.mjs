/* Corre o Worker real em Node, com KV em memória e edições de exemplo. */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";

// fileURLToPath e não .pathname: em Windows o pathname vem "/C:/..." e com
// os espaços por descodificar, e o readFile não encontra nada.
const PUBLICO = fileURLToPath(new URL("../public/", import.meta.url));
const loja = new Map();

const env = {
  APP_TOKEN: "chave-app",
  INGEST_TOKEN: "chave-rotinas",
  VENERA: {
    get: async (k) => (loja.has(k) ? loja.get(k) : null),
    put: async (k, v) => void loja.set(k, v),
  },
  ASSETS: {
    fetch: async (request) => {
      let caminho = new URL(request.url).pathname;
      if (caminho === "/" || !extname(caminho)) caminho = "/index.html";
      try {
        const corpo = await readFile(join(PUBLICO, caminho));
        const tipos = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".json": "application/json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        };
        return new Response(corpo, {
          headers: { "content-type": tipos[extname(caminho)] || "application/octet-stream" },
        });
      } catch {
        return new Response("nao encontrado", { status: 404 });
      }
    },
  },
};

/* --------------------------------------------------------- edições falsas -- */

const dia = (recuo) => new Date(Date.now() - recuo * 864e5).toISOString().slice(0, 10);

const fonte = (titulo, url) => ({ titulo, url });

const financas = (d, titulo, resumo, itens) => ({
  rotina: "financas-geopolitica", data: d, titulo, resumo, itens,
});
const ia = (d, titulo, resumo, itens) => ({
  rotina: "inteligencia-artificial", data: d, titulo, resumo, itens,
});

const EXEMPLOS = [
  financas(dia(0), "Inflação nos EUA trava expectativa de cortes",
    "O IPC de julho veio acima do consenso e empurrou as yields para cima. Na Europa, o gás volta a subir com a manutenção prolongada de dois terminais noruegueses.",
    [
      { titulo: "IPC acima do consenso adia cortes", impacto: "alto",
        texto: "O índice de preços no consumidor subiu 0,4% em julho, contra os 0,2% esperados. A componente de serviços continua a ser o travão, e o mercado de futuros passou a atribuir menos de 30% de probabilidade a um corte em setembro. As yields a 10 anos subiram 9 pontos base. Porque interessa: adia o alívio nas taxas e pressiona as tecnológicas com múltiplos altos, onde tens a maior exposição.",
        fontes: [fonte("Bureau of Labor Statistics", "https://www.bls.gov/cpi/"), fonte("Reuters", "https://www.reuters.com/markets/")] },
      { titulo: "Gás europeu sobe com manutenção prolongada", impacto: "medio",
        texto: "Dois terminais noruegueses estenderam a paragem por mais dez dias, levando o TTF a máximos de seis semanas. Os armazenamentos europeus continuam acima da média sazonal, o que limita o impacto. Porque interessa: mexe com a inflação europeia no outono e com as utilities do índice.",
        fontes: [fonte("Gassco", "https://www.gassco.no/")] },
      { titulo: "Bitcoin consolida antes da decisão do Fed", impacto: "baixo",
        texto: "O bitcoin manteve-se numa faixa estreita durante a semana, com volumes abaixo da média nas principais praças. Os fluxos para ETF spot foram neutros, sem saídas relevantes. Porque interessa: sem catalisador próprio, a cripto está a seguir as taxas — a decisão do Fed vale mais do que qualquer notícia do setor.",
        fontes: [fonte("Kraken", "https://www.kraken.com/")] },
    ]),
  ia(dia(0), "Modelos abertos aproximam-se nos testes de raciocínio",
    "Um novo modelo de pesos abertos ficou a poucos pontos dos fechados em matemática e código. Do lado da infraestrutura, mais um contrato de energia para data centers.",
    [
      { titulo: "Pesos abertos encurtam a distância", impacto: "alto",
        texto: "O modelo apresentado esta semana ficou a menos de três pontos dos melhores fechados em provas de matemática e programação, com um custo por token muito inferior. As avaliações são do próprio fabricante e ainda não foram replicadas por terceiros. Porque interessa: se a diferença se confirmar, muda o cálculo de custo para quem constrói produtos em cima de APIs.",
        fontes: [fonte("Paper", "https://arxiv.org/")] },
      { titulo: "Mais um contrato de energia para data centers", impacto: "medio",
        texto: "Foi assinado um acordo de fornecimento a vinte anos para alimentar um campus de computação nos Estados Unidos. O contrato entra em vigor em 2028, o que dá a medida do horizonte destes investimentos. Porque interessa: a energia é o verdadeiro travão à expansão, e os prazos longos explicam o interesse nas cotadas de infraestrutura.",
        fontes: [fonte("Comunicado", "https://www.sec.gov/")] },
    ]),
  financas(dia(1), "Banco central mantém taxas e sinaliza pausa longa",
    "Decisão sem surpresas, mas o comunicado retirou a referência a novas subidas. Mercados leram como o fim do ciclo.",
    [
      { titulo: "Comunicado retira referência a subidas", impacto: "alto",
        texto: "A decisão manteve as taxas inalteradas, mas o parágrafo sobre disponibilidade para novas subidas desapareceu do comunicado. Na conferência, a presidente evitou confirmar o fim do ciclo. Porque interessa: a linguagem é o sinal, não a decisão — e o mercado já a está a descontar.",
        fontes: [fonte("BCE", "https://www.ecb.europa.eu/")] },
      { titulo: "Euro cede face ao dólar", impacto: "baixo",
        texto: "O euro perdeu meio cêntimo após o comunicado, num movimento contido e sem seguimento nas sessões asiáticas. Porque interessa: o diferencial de taxas continua a mandar no par, sem novidade de fundo.",
        fontes: [fonte("Reuters", "https://www.reuters.com/markets/currencies/")] },
    ]),
  ia(dia(2), "Regulação europeia entra na fase dos modelos de uso geral",
    "Começaram a aplicar-se as obrigações para modelos de uso geral. Documentação técnica e resumo dos dados de treino passam a ser exigíveis.",
    [
      { titulo: "Obrigações de documentação em vigor", impacto: "medio",
        texto: "Os fornecedores de modelos de uso geral passam a ter de manter documentação técnica atualizada e publicar um resumo suficientemente detalhado dos dados usados no treino. Os modelos já colocados no mercado têm um prazo mais longo para se conformarem. Porque interessa: aumenta o custo de operar na União e favorece quem já tem processos de conformidade montados.",
        fontes: [fonte("Jornal Oficial", "https://eur-lex.europa.eu/")] },
    ]),
  financas(dia(3), "Petróleo cai com dados fracos da indústria chinesa",
    "A produção industrial chinesa abrandou mais do que o esperado e arrastou o brent para mínimos do mês.",
    [
      { titulo: "Produção industrial chinesa abranda", impacto: "medio",
        texto: "O crescimento da produção industrial ficou abaixo das projeções pelo terceiro mês seguido, com o imobiliário a continuar a pesar. O brent perdeu 2,4% na sessão. Porque interessa: menos procura chinesa alivia a inflação importada na Europa, mas é mau sinal para o crescimento global.",
        fontes: [fonte("Gabinete Nacional de Estatística", "https://www.stats.gov.cn/")] },
    ]),
];

for (const e of EXEMPLOS) {
  loja.set(`edicao:${e.rotina}:${e.data}`, JSON.stringify({ ...e, recebido_em: new Date().toISOString() }));
  const chave = `indice:${e.rotina}`;
  const datas = JSON.parse(loja.get(chave) || "[]");
  loja.set(chave, JSON.stringify([...new Set([e.data, ...datas])].sort().reverse()));
}

/* ------------------------------------------------------------------ ponte -- */

http
  .createServer(async (req, res) => {
    const corpo = req.method === "POST" ? await new Promise((r) => {
      let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d));
    }) : undefined;

    const pedido = new Request(`http://localhost:8787${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: corpo,
    });
    const resposta = await worker.fetch(pedido, env);
    res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
    res.end(Buffer.from(await resposta.arrayBuffer()));
  })
  .listen(8787, () => console.log("venera em http://localhost:8787"));
