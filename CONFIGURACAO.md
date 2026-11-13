# Inventário compartilhado

Na Vercel, mantenha o projeto sem framework e com a raiz do repositório como diretório do projeto. Conecte uma base Upstash Redis e configure `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` no ambiente do deploy.

O único e-mail autorizado é `vitor.cogo@uniaves.com.br`. Para gerar o valor de `UNIAVES_ADMIN_PASSWORD_HASH`, coloque uma senha longa no gerenciador de senhas, copie-a e rode no PowerShell:

```powershell
Get-Clipboard | node -e 'const c=require("node:crypto");const p=require("node:fs").readFileSync(0,"utf8").replace(/\r?\n$/, "");const s=c.randomBytes(16).toString("hex");console.log(s+":"+c.scryptSync(p,s,64).toString("hex"))'
```

Cole o resultado como variável sensível no painel da Vercel e limpe a área de transferência. A senha original é usada na tela de login.

Depois do deploy, entre no painel e importe uma vez o backup JSON do inventário completo. Se houver alterações mais recentes no navegador, use o backup exportado por ele. Os visitantes recebem os registros cadastrados e podem pesquisar e filtrar. O login administrativo habilita a edição, o cadastro, a exclusão, a importação e a exportação. As alterações gravadas passam a valer para os próximos carregamentos do painel.
