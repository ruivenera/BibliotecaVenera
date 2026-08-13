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
| Rotinas no Claude Code | criadas e apontadas à Venera; falta o ambiente (ver abaixo) |

Publicado pelo **Caminho B** (`npx wrangler deploy` do Windows), não pelo A. O primeiro deploy foi manual porque o repositório ainda não estava ligado; se o Workers Builds estiver agora ligado, este commit é o primeiro a publicar sozinho. Enquanto não estiver, cada alteração precisa de `npm run deploy`.

O repositório é **público** e o histórico do upload inicial foi preservado, por isso o antigo `dev.vars` continua acessível pelo SHA — não faz mal, só tinha valores de exemplo, mas convém não lá pôr nada de verdade.

As duas rotinas existem e já apontam para cá — reaproveitadas das antigas, que faziam rascunhos no Gmail. Ficaram sem conectores, sem notificações, com este repositório como fonte. **Falta o ambiente:** `VENERA_URL`, `VENERA_TOKEN` e o domínio na allowlist. Sem isso o `publicar.sh` morre na primeira linha.

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
- **As rotinas nunca conseguiram publicar.** Um `Run now` na de Finanças passou dez minutos sem pôr nada na estante. O `publicar.sh` está bom — correu à mão contra produção e devolveu `OK publicado` — portanto a falha é dentro do ambiente da rotina. O suspeito é a allowlist de rede. Falta ler a sessão para confirmar
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

**Estante como elemento âncora.** Cada edição é uma lombada: altura conforme o número de temas, cor conforme a rotina, a de hoje realçada. Codifica dados reais, não é decoração.

**A app parte o texto no `Porque interessa:`** e mostra essa frase numa caixa destacada. Se o prompt da rotina deixar de a produzir, o tema aparece na mesma, só sem a caixa.

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
- **Nas rotinas, remover todos os conectores.** Só precisam de pesquisa e do script.
- Ao mexer no `sw.js`, subir o `VERSAO` — senão os aparelhos ficam com a versão antiga em cache.

## Ideias por fazer

- Exportar notas e cartões para ficheiro (não há forma de tirar os dados de lá)
- Procura dentro das edições arquivadas, não só nas notas
- Etiquetas nas notas, para separar matéria de estudo de notas de mercado (nada implementado; implicaria campo novo no `limparNota()` do Worker)
- Uma terceira rotina para matéria do curso de sargentos
