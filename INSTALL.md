# Instalar a Venera do zero

Quatro fases: repositório → Cloudflare → telemóvel → rotinas. Faz as três primeiras de seguida; a quarta só depois de a app abrir.

Antes de começares, confirma o Node:

```bash
node -v      # tem de ser 20 ou mais recente
```

Se for antigo: `brew install node`.

---

## Fase 1 — Repositório no GitHub

### 1.1 Pôr os ficheiros numa pasta

Descarrega os ficheiros e mete-os numa pasta `venera` com esta estrutura:

```
venera/
├── src/index.js            o Worker
├── public/                 a PWA (index.html, app.js, sw.js, manifest, ícones)
├── teste/servidor.mjs      servidor local de experiência
├── publicar.sh             usado pelas rotinas
├── wrangler.toml
├── package.json
├── .gitignore
├── .dev.vars.example
├── README.md
├── SCHEMA.md
└── INSTALL.md
```

```bash
cd ~/onde-guardas-os-projetos/venera
chmod +x publicar.sh
```

### 1.2 Experimentar antes de publicar

Vale a pena ver a app a funcionar antes de mexer na Cloudflare:

```bash
npm run local
```

Abre `http://localhost:8787`, cola a chave `chave-app`. Traz cinco edições de exemplo. Ctrl+C para parar.

### 1.3 Criar o repositório

```bash
git init -b main
git add .
git commit -m "Venera: biblioteca de estudo"
git remote add origin https://github.com/O-TEU-UTILIZADOR/O-TEU-REPOSITORIO.git
git push -u origin main
```

Se o repositório foi criado com README ou .gitignore, o push é recusado por ter história diferente. Nesse caso, antes do push:

```bash
git pull --rebase origin main
```

Se o `git push` pedir palavra-passe, é um personal access token do GitHub, não a password da conta.

Privado é a escolha certa. Não há segredos nos ficheiros — os tokens ficam na Cloudflare e nas definições das rotinas — mas não há razão para isto estar aberto.

---

## Fase 2 — Publicar na Cloudflare

### 2.1 Entrar

```bash
npx wrangler login
```

Abre o browser e pede autorização. Confirma com `npx wrangler whoami`.

### 2.2 Criar o armazenamento

```bash
npx wrangler kv namespace create VENERA
```

Se der erro de comando desconhecido, tens uma versão antiga: usa `npx wrangler kv:namespace create VENERA`.

Devolve algo assim:

```
[[kv_namespaces]]
binding = "VENERA"
id = "8f3c1a90b2e7443fae91c4d7f0b6e512"
```

Copia esse `id` para o `wrangler.toml`, por cima de `COLA_AQUI_O_ID_DO_KV`.

### 2.3 Publicar

```bash
npm run deploy
```

No fim publica em `https://bibliotecavenera.ruivenera18.workers.dev`.

O `wrangler.toml` já traz `name = "bibliotecavenera"`, o mesmo nome do Worker criado no painel — este deploy escreve por cima do código de exemplo, que é o que se pretende. Se o wrangler avisar que o Worker foi alterado fora do wrangler e perguntar se queres continuar, responde que sim. Se mudares o `name`, ficas com dois Workers em vez de um.

Neste momento a app responde `401` a tudo — ainda não há chaves. É o esperado.

### 2.4 Criar as duas chaves

```bash
openssl rand -hex 32     # chave da app
openssl rand -hex 32     # chave das rotinas
```

Guarda as duas onde guardas as tuas palavras-passe. São diferentes de propósito: a app lê edições e mexe nas notas, as rotinas só escrevem edições. Se uma vazar, a outra continua fechada.

```bash
npx wrangler secret put APP_TOKEN        # cola a primeira
npx wrangler secret put INGEST_TOKEN     # cola a segunda
```

O terminal não mostra o que colas. É normal.

### 2.5 Confirmar

```bash
curl -s https://bibliotecavenera.ruivenera18.workers.dev/api/chave \
  -H "Authorization: Bearer A_CHAVE_DA_APP"
```

Resposta esperada: `{"ok":true,"rotinas":{...}}`.

Sem o cabeçalho tem de dar `{"erro":"nao_autorizado"}` — se der outra coisa, alguma chave não ficou bem posta.

### 2.6 Guardar a alteração

```bash
git add wrangler.toml
git commit -m "Ligar o KV"
git push
```

---

## Fase 3 — Instalar no telemóvel

1. Abre o endereço no Safari (iPhone) ou Chrome (Android).
2. Cola a chave da app. Fica guardada nesse aparelho, não a voltas a escrever.
3. A estante aparece vazia — ainda não há edições. É o esperado.
4. **Partilhar → Adicionar ao ecrã principal.** Passa a abrir sem barra de browser e a funcionar offline.

Repete no MacBook com a mesma chave. As notas e cartões sincronizam entre os dois.

Para testar já: cria uma nota, espera dois segundos até o indicador no topo dizer `guardado`, e abre a app no outro aparelho.

---

## Fase 4 — Ligar as rotinas

Só depois de a app abrir. Em `claude.ai/code/routines`.

### 4.1 Ambiente (uma vez só)

Nova routine → seletor de ambiente → definições:

**Network access: Custom** — junta `bibliotecavenera.ruivenera18.workers.dev` e mantém a lista predefinida de package managers. Sem isto o `curl` do `publicar.sh` leva `403 host_not_allowed` e a rotina termina como se tivesse corrido bem.

**Environment variables:**

| Nome | Valor |
| --- | --- |
| `VENERA_URL` | `https://bibliotecavenera.ruivenera18.workers.dev` |
| `VENERA_TOKEN` | a chave das rotinas (`INGEST_TOKEN`) |

### 4.2 As duas rotinas

Cria duas, com os prompts que estão no README:

| Nome | Prompt |
| --- | --- |
| Venera · Finanças & Geopolítica | secção "Prompt — Finanças & Geopolítica" |
| Venera · Inteligência Artificial | secção "Prompt — Inteligência Artificial" |

Em cada uma:

- **Repositório:** `venera` (o mesmo). Se o Claude não o vir por ser privado, dá-lhe acesso na integração do GitHub.
- **Ambiente:** o da 4.1.
- **Trigger:** Schedule, diário, 07:00.
- **Conectores: remove todos.** O Claude pode usar qualquer ferramenta de um conector incluído sem pedir autorização durante a corrida, e estas rotinas só precisam de pesquisa e do script.

### 4.3 Primeira corrida

**Run now** em cada uma e **abre a sessão** para confirmar que aparece `OK publicado`.

Verde na lista não chega: significa apenas que a sessão arrancou e terminou sem erro de infraestrutura, não que a edição foi publicada.

Depois recarrega a app. A lombada de hoje tem de estar na estante.

---

## Se correr mal

| Sintoma | Causa provável |
| --- | --- |
| App diz "Chave recusada" | `APP_TOKEN` não foi definido, ou colaste a das rotinas |
| Rotina verde mas estante vazia | domínio fora da allowlist do ambiente (`403 host_not_allowed`) |
| `publicar.sh` devolve 401 | `VENERA_TOKEN` não é o `INGEST_TOKEN` |
| `publicar.sh` devolve 422 | o JSON não cumpre o SCHEMA.md — o campo `detalhes` diz o quê |
| Estante mostra ontem | `curl .../api/indice/financas-geopolitica` — se hoje não estiver lá, falhou a rotina |
| Notas não passam de aparelho para aparelho | indicador no topo em `por guardar`: toca nele para forçar |

Ver o que o Worker recebeu, em tempo real:

```bash
npx wrangler tail
```

## Mudar chaves mais tarde

```bash
npx wrangler secret put APP_TOKEN     # cola a nova
```

Entra em vigor logo. Depois é apagar a antiga em cada aparelho (a app pede a nova quando levar 401) e, se mudares a das rotinas, atualizar o `VENERA_TOKEN` no ambiente.
