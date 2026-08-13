# Venera — contexto do projeto

Biblioteca de estudo pessoal do Rui. Duas rotinas do Claude Code arquivam uma edição por dia (finanças/geopolítica e IA); ele lê, tira notas e revê por repetição espaçada. Utilizador único, dois aparelhos (iPhone e MacBook).

```
routine (07:00, cloud da Anthropic)
   └─ publicar.sh → POST /api/ingest ─┐
                                      ├─ Worker + KV ─ PWA (estante · notas · revisão)
   app ──── POST /api/sync ───────────┘
```

## Estado atual

**Publicado e a responder em https://bibliotecavenera.ruivenera18.workers.dev.**

| | Estado |
| --- | --- |
| Código do Worker e da PWA | pronto |
| Worker `bibliotecavenera` na Cloudflare | publicado; o "Hello World!" desapareceu |
| KV namespace | `VENERA`, id `948b4582fa2446a199cdb95573e1b2ba`, já no `wrangler.toml` |
| Secrets `APP_TOKEN` / `INGEST_TOKEN` | definidos por `wrangler secret put` |
| Repositório GitHub | github.com/ruivenera/BibliotecaVenera, `main` enviado |
| Rotinas no Claude Code | a publicar sozinhas desde 13/08/2026 |

Publicado pelo **Caminho B** (`npx wrangler deploy` do Windows), não pelo A. O primeiro deploy foi manual porque o repositório ainda não estava ligado; se o Workers Builds estiver agora ligado, este commit é o primeiro a publicar sozinho. Enquanto não estiver, cada alteração precisa de `npm run deploy`.

O repositório é **público** e o histórico do upload inicial foi preservado, por isso o antigo `dev.vars` continua acessível pelo SHA — não faz mal, só tinha valores de exemplo, mas convém não lá pôr nada de verdade.

As duas rotinas foram reaproveitadas das antigas, que faziam rascunhos no Gmail. Ficaram sem conectores, sem notificações, com este repositório como fonte, e publicam sozinhas desde 13/08/2026 — a de Finanças às 08:00 UTC (diária), a de IA às 13:00 UTC (dias úteis).

**O que as destrancou foi a allowlist de rede do ambiente.** Enquanto o domínio não lá esteve, as corridas terminavam sem publicar nada e sem forma de saber porquê: um diagnóstico que só fazia `curl` e publicar, sem pesquisa, também não produzia nada. Quando algo parar de aparecer na estante, é o primeiro sítio a olhar.

O `VENERA_URL` e o `VENERA_TOKEN` **não** estão no ambiente: vão dentro dos prompts das rotinas, porque a interface das rotinas esteve inacessível durante a montagem. Funciona, mas o token fica legível por quem tiver acesso à API das rotinas — vale a pena movê-lo para variável de ambiente e limpar os prompts.

A rotina de IA não é um digest como a de finanças: é um curso diário por capítulos, herdado do email. Ver a nota no README.

### O que já foi verificado

Com um servidor Node que corre o código real do Worker (`teste/servidor.mjs`, KV em memória, cinco edições de exemplo) e Playwright:

- `/api/ingest`: 401 sem token, 422 com JSON inválido (com lista de problemas), 200 válido, republicar o mesmo dia sobrepõe em vez de duplicar
- `/api/feed`, `/api/estante`, `/api/edicao/...`: fechados atrás do `APP_TOKEN`
- Percurso completo na app: abrir edição → criar cartão → rever → criar nota → nota vira cartão
- `/api/sync` entre dois contextos de browser, nos dois sentidos
- Intervalos SM-2 distintos nos quatro botões
- Zero erros de consola

E em produção, contra o Worker publicado:

- A PWA é servida na raiz e os nove ficheiros do `public/` respondem 200 com o content-type certo — o binding `[assets]` está bom
- `/api/estante` e `/api/chave`: 401 sem chave, 200 com o `APP_TOKEN`
- `/api/ingest`: 401 com o `APP_TOKEN`, 422 com o `INGEST_TOKEN` — os dois tokens estão trocados por miúdos e cada um só abre a sua porta
- Service worker regista, fica `ativo` e mete as cinco entradas da casca em cache

### O que **não** foi verificado

- Workers Builds — o deploy foi por `wrangler`, o repositório nunca chegou a estar ligado
- Offline a sério: a casca fica em cache, mas nunca se cortou a rede para ver a app abrir
- Qualidade das fontes na rotina de IA. A primeira aula automática (Dia 29) trouxe 16 fontes de apenas dois domínios, `github.com` e `techstartups.com`, quando o tema — CrewAI, AutoGen, LangGraph — pedia a documentação oficial de cada um. O prompt já manda preferir a fonte primária; não chegou
- Tipos de letra: continuam por ver, mas já se sabe porquê. O pedido ao `fonts.googleapis.com` **é feito**; o proxy do ambiente devolve `text/html` em vez de CSS e o browser recusa a folha de estilo. É limitação do ambiente de teste, não da app — o markup está correto. A primeira vez que vires a tipografia real é no iPhone

### Verificado em produção, com edição real na estante

A 13/08/2026 publicou-se à mão uma edição de finanças com seis temas (`./publicar.sh`, `OK publicado`, 200). A app mostra-a toda: lombada na estante, resumo, os seis verbetes, as seis caixas de `Porque interessa` e os sete links de fontes. O percurso `/api/chave` → `/api/estante` → `/api/edicao` funciona contra o Worker publicado.

## Ficheiros

```
src/index.js          Worker: API + serve a PWA. Toda a lógica de servidor está aqui.
public/index.html     Casca da PWA + todo o CSS (sem framework, sem build)
public/app.js         Estado, rotas, leitura, notas, SM-2, sincronização
public/sw.js          Cache offline
public/manifest.json  + icone.svg, icone-{180,192,512}.png, icone-mascara.png
teste/servidor.mjs    Corre o Worker real em Node. `npm run local`, chave: chave-app
publicar.sh           Usado pelas rotinas para publicar a edição
wrangler.toml         name = "bibliotecavenera"; falta o id do KV
INSTALL.md            Passo a passo (Caminho A sem terminal, Caminho B com)
README.md             Visão geral + os prompts das duas rotinas
SCHEMA.md             Formato do JSON da edição
```

## Decisões e porquês

**Um só Worker serve a API e a PWA.** Um deploy, um domínio, zero CORS. O `[assets]` serve o `public/`; tudo o que começa em `/api` vai ao código.

**Dois tokens separados.** `INGEST_TOKEN` só escreve edições (é o que as rotinas têm); `APP_TOKEN` lê edições e mexe na biblioteca (é o que está no telemóvel). Se um vazar, o outro continua fechado. Comparação em tempo constante em `confere()`.

**Sincronização por diferenças, ganha o mais recente por item.** O cliente guarda um `Set` de ids sujos em localStorage e envia-os no `/api/sync`; o servidor funde por `atualizado_em` e devolve o que mudou desde `desde`. Com um utilizador chega e não precisa de resolução de conflitos. Apagar é `apagado: true`, nunca remoção — senão o outro aparelho ressuscitava o item.

**SM-2 com dois desvios deliberados** (documentados em `agendar()`): no original, "Difícil" e "Bom" dão sempre o mesmo intervalo e só mexem na facilidade, o que faria os quatro botões mostrarem o mesmo prazo. "Fácil" salta à frente (4 dias à primeira, 10 à segunda), "Difícil" avança a 1,2×. Notas erradas devolvem o cartão ao fim da sessão, não a outro dia.

**Chaves em localStorage, biblioteca em localStorage, edições na Cache API.** As edições são grandes e já vêm cacheadas pelo service worker; notas e cartões são texto curto.

**A cor do título diz a rotina.** Os títulos dos temas herdam o `--marcador` — latão nas finanças, índigo na IA — em vez de serem todos papel. Serve a leitura e codifica o mesmo dado que a lombada. O título da edição fica em papel, para a hierarquia não se perder. Contraste medido sobre a tinta: 6,7:1 no latão, 5,9:1 no índigo.

**Tipografia de leitura: corpo pequeno, medida estreita, muito ar.** 16px com entrelinha 1,72 e a coluna a 36rem. Baixar o corpo sem estreitar a medida teria piorado a leitura, não melhorado — linha longa com letra pequena é o pior dos dois mundos. O espaço entre temas subiu para 3rem e os traços de separação passaram a `--tinta-2`, quase invisíveis: é o espaço que separa, não a linha.

**Estante como elemento âncora.** Cada edição é uma lombada: altura conforme o número de temas, cor conforme a rotina, a de hoje realçada. Codifica dados reais, não é decoração.

**A app parte o texto no `Porque interessa:`** e mostra essa frase numa caixa destacada. Se o prompt da rotina deixar de a produzir, o tema aparece na mesma, só sem a caixa.

**O `painel` é limpo, não validado.** Os campos obrigatórios da edição dão `422` quando falham; o painel não. Um bloco torto é descartado em silêncio e a edição publica na mesma — a edição é a carga, o painel é o resumo por cima. Trocar isto por validação estrita faria uma tabela mal formatada deitar fora um dia inteiro de pesquisa. Vem do relatório que ia por email: índices, carteira, medidor de risco, teatros de conflito, oportunidades/riscos e veredicto, mais o `progresso` para o curso de IA.

**O painel traz a organização do email, não a estética.** Tabelas, selos e hierarquia densa, mas dentro da paleta da casa. Só se acrescentou `--sobe` (verde-sálvia abafado) porque a paleta não tinha como marcar variações positivas; o `--desce` reutiliza o rust. A `variacao` viaja como número e é a app que lhe põe a seta, o sinal e a cor — o JSON não manda `"▼ -2,4%"`.

## Convenções

- **Tudo em português europeu**: interface, comentários, nomes de variáveis e funções (`alterar`, `sincronizar`, `lombada`, `verbete`, `folha`). Manter.
- **Sem framework e sem passo de build.** JavaScript e CSS à mão. Não introduzir React, Tailwind nem bundler — a app é pequena e o Workers Builds só corre `npx wrangler deploy`.
- CSS por variáveis no `:root`. Tinta escura, papel, latão (finanças) e índigo (IA).
- Nada de `innerHTML` com dados sem passar pelo `esc()`.
- Alterações a notas/cartões passam sempre por `alterar(tipo, item)` — é quem carimba a hora, grava e agenda a sincronização.

## Armadilhas

- **`wrangler.toml` tem `id = "COLA_AQUI_O_ID_DO_KV"`.** A primeira build falha com `KV namespace not found` enquanto lá estiver.
- **O nome do Worker tem de continuar `bibliotecavenera`**, senão o deploy cria um segundo Worker.
- **As rotinas precisam do domínio na allowlist do ambiente** (Network access: Custom). Sem isso o `curl` leva `403 host_not_allowed` e a rotina termina verde na mesma — verde não é sinal de sucesso, é preciso ver `OK publicado` na sessão.
- **O domínio vai na allowlist, nunca no setup script.** O setup script é bash: uma linha com `bibliotecavenera.ruivenera18.workers.dev` solta é lida como um comando, não existe, e a sessão morre logo no arranque com `exit code 127: command not found` — antes sequer de chegar ao `publicar.sh`. Sintoma a decorar, porque parece lentidão: a rotina dispara, o `last_fired_at` atualiza, não há erro na API das rotinas, e nunca aparece nada na estante.
- **Nas rotinas, remover todos os conectores.** Só precisam de pesquisa e do script.
- Ao mexer no `sw.js`, subir o `VERSAO` — senão os aparelhos ficam com a versão antiga em cache.

## Ideias por fazer

- Exportar notas e cartões para ficheiro (não há forma de tirar os dados de lá)
- Procura dentro das edições arquivadas, não só nas notas
- Etiquetas nas notas, para separar matéria de estudo de notas de mercado (nada implementado; implicaria campo novo no `limparNota()` do Worker)
- Uma terceira rotina para matéria do curso de sargentos
