# Inventário compartilhado

O projeto InventarioUniaves no Supabase fornece a base de dados e o login. A API usa uma chave publicável e as políticas de acesso do banco restringem gravações ao UID da conta administrativa. Visitantes veem a consulta pública, sem observações internas.

Na Vercel, use a raiz do repositório e o preset Other. A pasta `api/` contém a função do inventário. Publique a branch `inventario-compartilhado` ou integre-a à branch de produção. Para entrar, use a conta já cadastrada no Supabase Auth com o e-mail confirmado.
