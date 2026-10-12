import Fastify from "fastify";
import formbody from "@fastify/formbody";
import view from "@fastify/view";
import handlebars from "handlebars";
import postgres from "@fastify/postgres";

export async function buildApp() {
  // Create Fastify instance
  const app = Fastify({ logger: true });

  // Register plugins
  await app.register(postgres, {
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost/postgres'
  })
  await app.register(formbody);
  await app.register(view, {
    engine: { handlebars: handlebars },
    root: new URL("./views/", import.meta.url).pathname
  });

  // Health check endpoint: also checks that the database answers
  app.get("/health", async (_req, reply) => {
    try {
      await app.pg.query("SELECT 1");
      return { ok: true, db: "up" };
    } catch (err) {
      app.log.error(err, "Health check failed");
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });

  // Get all quotes endpoint
  app.get("/", async (_req, reply) => {
    /******* TODO SELECT quotes from DB ******/
    const result = await app.pg.query('SELECT * FROM quotes')
    const quotes = result.rows;

    // Placeholder test quotes
   // const quotes = [{text: "quote 1", author: "author 1"}, {text: "quote 2", author: "author 2"}];
    return reply.view("index.hbs", { quotes });
  });

  // JSON API: return all quotes
  app.get("/api/quotes", async () => {
    const result = await app.pg.query("SELECT * FROM quotes");
    return result.rows;
  });


  // Post new quote endpoint
  app.post("/quotes", async (req, reply) => {
    const author = (req.body?.author ?? "").trim();
    const text = (req.body?.text ?? "").trim();

    if (!text) {
      // Keep it simple: redirect back
      return reply.redirect("/");
    }

    /******* TODO INSERT quote into DB ******/
    await app.pg.query('INSERT INTO quote (author, text) VALUES ($1, $2)', [author || "anonymous", text]);

    app.log.info({quote: { author: author || "anonymous", text }}, 'New quote added');

    return reply.redirect("/");
  });

  return app;
};
