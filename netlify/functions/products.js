import mysql from "mysql2/promise";

let pool;

export default async (req) => {
  pool ||= mysql.createPool({
    host: process.env.DB_HOST,      // 예: mysql.yourdomain.com (Cloudflare Tunnel)
    user: process.env.DB_USER,      // 읽기전용 계정
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,  // 예: fitpl
    waitForConnections: true,
    connectionLimit: 5,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const url = new URL(req.url);
  const q         = url.searchParams.get("q");
  const category  = url.searchParams.get("category");
  const sort      = url.searchParams.get("sort") ?? "rating_desc";
  const limit     = Math.min(Number(url.searchParams.get("limit") ?? 12), 100);
  const offset    = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  // Traveler 파라미터
  const country   = url.searchParams.get("country");
  const city      = url.searchParams.get("city");
  const activity  = url.searchParams.get("activity"); // "beach,shopping"
  let scoreExpr = "0"; const scoreParams = [];
  if (city)    { scoreExpr += " + IF(city = ?, 10, 0)";        scoreParams.push(city); }
  if (country) { scoreExpr += " + IF(country = ?, 5, 0)";      scoreParams.push(country); }
  if (activity){ scoreExpr += " + IF(style_tag LIKE ?, 3, 0)"; scoreParams.push(`%${activity.split(",")[0].trim()}%`); }
  const traveler = Boolean(city || country || activity);

  const sortMap = {
    rating_desc: "rating DESC, review_count DESC",
    review_desc: "review_count DESC, rating DESC",
    price_asc:   "price ASC",
    price_desc:  "price DESC",
  };
  const orderBy = traveler ? `score DESC, review_count DESC, rating DESC`
                           : (sortMap[sort] ?? sortMap.rating_desc);

  const where = []; const params = [];
  if (q)        { where.push("(name LIKE ? OR style_tag LIKE ?)"); params.push(`%${q}%`,`%${q}%`); }
  if (category) { where.push("category = ?"); params.push(category); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // ⬇️ 덤프 스키마에 맞게 테이블/컬럼명 필요 시 교체
  const sql = `
    SELECT
      product_id, brand, name, category, price, rating, review_count,
      image_url, style_tag, city, country, (${scoreExpr}) AS score
    FROM products
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  try {
    const [rows] = await pool.query(sql, [...scoreParams, ...params, limit, offset]);
    return new Response(JSON.stringify({ items: rows, traveler }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};