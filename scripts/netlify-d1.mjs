export function createRestDatabase({ accountId, databaseId, token }) {
  const endpoint = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    'https://api.cloudflare.com',
  );

  async function query(sql, params) {
    // Cloudflare's REST API accepts strings. SQLite decodes each bound value back to its original type.
    const statementSql = sql.replaceAll('?', () => "json_extract(?, '$')");
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: statementSql, params: params.map((value) => JSON.stringify(value)) }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) throw new Error('The journal database is unavailable.');
    const result = await response.json();
    const statement = result.result?.[0];
    if (result.success !== true || statement?.success !== true) {
      throw new Error('The journal database could not complete the request.');
    }
    return statement;
  }

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            run: () => query(sql, params),
            all: () => query(sql, params),
          };
        },
      };
    },
  };
}
