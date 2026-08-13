# Instalar a Venera

Dois caminhos. O **A** não usa terminal nenhum: ligas o repositório ao Worker e a Cloudflare passa a publicar sozinha a cada push. O **B** é pelo terminal, se preferires.

Em qualquer dos casos, a única parte que pede um computador é o primeiro envio dos ficheiros para o GitHub — há ícones em PNG que têm de ser carregados, não escritos. Depois disso, faz-se tudo pelo browser, telemóvel incluído.

---

# Caminho A — sem terminal

## 1. Pôr os ficheiros no GitHub

No computador, descarrega os ficheiros e junta-os numa pasta com esta estrutura:

```
venera/
├── src/index.js
├── public/          index.html, app.js, sw.js, manifest.json, icone.svg, icone-*.png
├── teste/servidor.mjs
├── publicar.sh
├── wrangler.toml
├── package.json
├── .gitignore
├── .dev.vars.example
├── README.md
├── SCHEMA.md
└── INSTALL.md
```

Abre o teu repositório no github.com → **Add file** → **Upload files** → arrasta a pasta inteira para a caixa. O GitHub mantém as subpastas. Escreve a mensagem "Venera" e **Commit changes**.

Confirma no separador Code que aparecem `src/`, `public/` e o `wrangler.toml`. Se o `public/` só tiver alguns ficheiros, arrasta outra vez o que faltar.

## 2. Criar o armazenamento e colar o id

Na Cloudflare: **Storage & Databases → KV → Create namespace**. Chama-lhe `VENERA`.

Copia o **ID** que aparece na lista (um texto longo de letras e números).

Volta ao GitHub, abre o `wrangler.toml`, carrega no lápis e substitui:

```toml
id = "COLA_AQUI_O_ID_DO_KV"
```

pelo id verdadeiro:

```toml
id = "8f3c1a90b2e7443fae91c4d7f0b6e512"
```

**Commit changes.**

## 3. Ligar o repositório ao Worker

Cloudflare → **Workers & Pages** → `bibliotecavenera` → **Settings** → **Builds** → **Connect**.

Escolhe a conta GitHub (autoriza a aplicação da Cloudflare se for a primeira vez) e o repositório. Depois:

| Definição | Valor |
| --- | --- |
| Git branch | `main` |
| Build command | deixa vazio — não há passo de compilação |
| Deploy command | `npx wrangler deploy` (é o que já vem) |

Guarda. A Cloudflare arranca uma build. Acompanha em **Settings → Builds**; demora um minuto ou dois.

Quando terminar, abre `https://bibliotecavenera.ruivenera18.workers.dev`. O "Hello World!" desapareceu e aparece o ecrã escuro a pedir uma chave.

A partir daqui, cada commit no `main` volta a publicar sozinho.

## 4. As duas chaves

Ainda na Cloudflare: `bibliotecavenera` → **Settings** → **Variables and Secrets** → **Add**.

Adiciona duas, ambas com **Type: Secret**:

| Variable name | Value |
| --- | --- |
| `APP_TOKEN` | a chave que vais escrever na app |
| `INGEST_TOKEN` | a chave que as rotinas vão usar |

**Deploy** para aplicar.

Para gerar os valores sem terminal, usa o gerador de palavras-passe do iPhone (ao criar uma password nova, "Outras opções → Editar palavra-passe forte") ou o teu gestor de passwords. Quanto mais longas melhor; 30 caracteres chega.

**Têm de ser diferentes uma da outra.** A app lê edições e mexe nas notas; as rotinas só escrevem edições. Se uma vazar, a outra continua fechada. Guarda as duas no gestor de passwords — a Cloudflare deixa de as mostrar depois de gravadas.

Os secrets sobrevivem aos deploys seguintes: não os voltas a pôr a cada push.

## 5. Abrir e instalar

1. Abre o endereço no Safari.
2. Cola a chave da app (`APP_TOKEN`).
3. A estante aparece vazia — ainda não há edições. É o esperado.
4. **Partilhar → Adicionar ao ecrã principal.**

Repete no computador com a mesma chave. As notas e cartões sincronizam entre os dois: escreve uma nota num, espera até o indicador no topo dizer `guardado`, e abre no outro.

## 6. Ligar as rotinas

Só depois de a app abrir. Em `claude.ai/code/routines`.

### Ambiente (uma vez só)

Nova routine → seletor de ambiente → definições:

**Network access: Custom** — junta `bibliotecavenera.ruivenera18.workers.dev` (sem `https://`) e mantém a lista predefinida de package managers. Sem isto o `curl` do `publicar.sh` leva `403 host_not_allowed` e a rotina termina como se tivesse corrido bem.

**Environment variables:**

| Nome | Valor |
| --- | --- |
| `VENERA_URL` | `https://bibliotecavenera.ruivenera18.workers.dev` |
| `VENERA_TOKEN` | o `INGEST_TOKEN` |

### As duas rotinas

| Nome | Prompt |
| --- | --- |
| Venera · Finanças & Geopolítica | secção "Prompt — Finanças & Geopolítica" do README |
| Venera · Inteligência Artificial | secção "Prompt — Inteligência Artificial" do README |

Em cada uma:

- **Repositório:** o mesmo. Se o Claude não o vir por ser privado, dá-lhe acesso na integração do GitHub.
- **Ambiente:** o de cima.
- **Trigger:** Schedule, diário, 07:00.
- **Conectores: remove todos.** O Claude pode usar qualquer ferramenta de um conector incluído sem pedir autorização durante a corrida, e estas rotinas só precisam de pesquisa e do script.

### Primeira corrida

**Run now** em cada uma e **abre a sessão** para confirmar que aparece `OK publicado`.

Verde na lista não chega: significa apenas que a sessão arrancou e terminou sem erro de infraestrutura, não que a edição foi publicada.

Depois recarrega a app. A lombada de hoje tem de estar na estante.

---

# Caminho B — pelo terminal

Se preferires publicar do Mac, salta os passos 2 e 3 e faz:

```bash
cd ~/onde-puseste/venera
npx wrangler login
npx wrangler kv namespace create VENERA     # cola o id no wrangler.toml
npx wrangler deploy
npx wrangler secret put APP_TOKEN
npx wrangler secret put INGEST_TOKEN
```

Para gerar as chaves: `openssl rand -hex 32`, duas vezes.

Os dois caminhos podem conviver: com o repositório ligado, um `wrangler deploy` do Mac continua a funcionar, mas o push é que manda na versão publicada.

Antes de publicar, dá para ver a app a funcionar sem tocar na Cloudflare:

```bash
npm run local      # http://localhost:8787, chave: chave-app
```

Traz cinco edições de exemplo.

---

# Se correr mal

| Sintoma | Causa provável |
| --- | --- |
| Continua a dizer "Hello World!" | a build ainda não correu, ou falhou — vê Settings → Builds |
| Build falha em `KV namespace not found` | o id no `wrangler.toml` está errado ou por preencher |
| Build falha em `Missing entry-point` | a pasta `src/` não subiu para o GitHub |
| App abre mas diz "Chave recusada" | `APP_TOKEN` não está nos secrets, ou colaste a das rotinas |
| App abre em branco | falta o `public/` — confirma que o `index.html` está no GitHub |
| Rotina verde mas estante vazia | domínio fora da allowlist do ambiente (`403 host_not_allowed`) |
| `publicar.sh` devolve 401 | `VENERA_TOKEN` não é o `INGEST_TOKEN` |
| `publicar.sh` devolve 422 | o JSON não cumpre o SCHEMA.md — o campo `detalhes` diz o quê |
| Estante mostra ontem | abre `/api/indice/financas-geopolitica` com a chave; se hoje não estiver lá, falhou a rotina |
| Notas não passam de aparelho para aparelho | indicador no topo em `por guardar`: toca nele para forçar |

O registo de cada build está em **Settings → Builds**, com a saída completa. É o primeiro sítio a olhar quando algo não aparece.

# Mudar chaves mais tarde

**Settings → Variables and Secrets → Edit**, escreve o novo valor, **Deploy**. Entra em vigor logo.

A app pede a nova assim que apanhar um 401. Se mudares a das rotinas, atualiza também o `VENERA_TOKEN` no ambiente da routine.
