const express = require("express");
const path = require("path");
const redis = require("redis");
const bcrypt = require("bcrypt");
const session = require("express-session");
const RedisStore = require("connect-redis").default;
const axios = require("axios"); // Asegúrate de instalar axios

// Crear cliente de Redis
const client = redis.createClient({
  host: "127.0.0.1",
  port: 6379,
});

// Manejar errores de conexión
client.on("error", (err) => {
  console.error("Error de conexión a Redis:", err);
});

// Conectar a Redis
client
  .connect()
  .then(() => {
    console.log("Conectado a Redis exitosamente");
  })
  .catch((err) => {
    console.error("Error al conectar a Redis:", err);
  });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchQuestions(topics) {
  const categoryIds = {
    geografia: 22,
    historia: 23,
    naturaleza: 17,
    random: 9,
  };

  for (const topic of topics) {
    try {
      const categoryId = categoryIds[topic];
      if (!categoryId) {
        console.error(`No hay categoría definida para ${topic}`);
        continue;
      }

      const url = `https://opentdb.com/api.php?amount=3&category=${categoryId}&difficulty=easy&type=boolean&lang=es`;
      console.log(`Fetching questions from URL: ${url}`);
      const response = await axios.get(url);
      const questions = response.data.results;

      if (questions.length === 0) {
        console.warn(`No se encontraron preguntas para ${topic}`);
        continue;
      }

      const today = new Date().toISOString().split("T")[0];

      for (let i = 0; i < questions.length; i++) {
        await client.hSet(
          `questions:${topic}:${today}`,
          i.toString(),
          JSON.stringify(questions[i])
        );
      }
      console.log(`Preguntas para ${topic} guardadas exitosamente.`);
    } catch (error) {
      console.error(`Error al obtener preguntas para ${topic}:`, error);
    }
    await delay(10000); // Retraso de 1 segundo entre solicitudes
  }
}

class Server {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;

    this.middlewares();
    this.routes();
  }

  middlewares() {
    this.app.use(express.static(path.join(__dirname, "../public")));
    this.app.set("view engine", "ejs");
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());

    this.app.use(
      session({
        store: new RedisStore({ client }),
        secret: "keysecret2307",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 1800000 },
      })
    );
  }

  async getScores(userId) {
    try {
      const globalScores = await client.zRangeWithScores(
        "scores:global",
        0,
        -1,
        "REV"
      );

      const personalScores = userId
        ? await client.zRangeWithScores(`scores:${userId}`, 0, -1, "REV")
        : [];

      return {
        globalScores,
        personalScores,
      };
    } catch (error) {
      console.error("Error al obtener las puntuaciones:", error);
      throw error;
    }
  }

  routes() {
    this.app.get("/", (req, res) => {
      if (req.session.username) {
        return res.redirect("/home");
      }
      res.render("login");
    });

    this.app.get("/error", (req, res) => {
      const { message } = req.query;
      res.render("error", { errorMessage: message });
    });

    this.app.get("/home", (req, res) => {
      if (!req.session.username) {
        return res.redirect("/");
      }
      res.render("home", { username: req.session.username });
    });

    // Rutas para cada categoría
    this.app.get("/category/:topic", async (req, res) => {
      const { topic } = req.params;
      const today = new Date().toISOString().split("T")[0];

      try {
        const questions = await client.hGetAll(`questions:${topic}:${today}`);
        if (!questions || Object.keys(questions).length === 0) {
          return res.render("error", {
            errorMessage: "No hay preguntas disponibles para esta categoría.",
          });
        }

        // Iniciar con la primera pregunta
        const questionList = Object.values(questions).map((q) => JSON.parse(q));
        res.render("questions_one_by_one", {
          topic,
          question: questionList[0],
          totalQuestions: questionList.length,
        });
      } catch (error) {
        console.error("Error al recuperar preguntas:", error);
        res.status(500).send("Error al cargar las preguntas.");
      }
    });

    this.app.post("/category/:topic/next-question", async (req, res) => {
      const { topic } = req.params;
      const { questionIndex, answer } = req.body;
      const today = new Date().toISOString().split("T")[0];

      try {
        const questions = await client.hGetAll(`questions:${topic}:${today}`);
        const questionList = Object.values(questions).map((q) => JSON.parse(q));

        let correct = false;
        if (questionIndex < questionList.length) {
          const currentQuestion = questionList[questionIndex];
          correct = currentQuestion.correct_answer === answer;

          if (correct) {
            await client.zIncrBy(`scores:${req.session.username}`, 50, topic); // Incrementa la puntuación del usuario
            await client.zIncrBy("scores:global", 50, req.session.username); // Incrementa la puntuación global
          }

          res.json({
            question: questionList[questionIndex + 1],
            nextIndex: questionIndex + 1,
            finished: questionIndex + 1 >= questionList.length,
            correct: correct,
          });
        } else {
          res.json({ finished: true });
        }
      } catch (error) {
        console.error("Error al procesar la respuesta:", error);
        res.status(500).send("Error al procesar la respuesta.");
      }
    });

    this.app.post("/register", async (req, res) => {
      const { username, email, password } = req.body;

      try {
        const userExists = await client.hExists("users", email);
        if (userExists) {
          return res.redirect("/error?message=El usuario ya está registrado.");
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await client.hSet(
          "users",
          email,
          JSON.stringify({ username, password: hashedPassword })
        );

        req.session.username = username;
        res.redirect("/home");
      } catch (err) {
        console.error("Error al registrar el usuario:", err);
        res.redirect("/error?message=Error al registrar el usuario.");
      }
    });

    this.app.post("/login", async (req, res) => {
      const { email, password } = req.body;

      try {
        const userData = await client.hGet("users", email);
        if (!userData) {
          return res.redirect("/error?message=El usuario no existe.");
        }

        const user = JSON.parse(userData);
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.redirect("/error?message=Contraseña incorrecta.");
        }

        req.session.username = user.username;
        res.redirect("/home");
      } catch (err) {
        console.error("Error al iniciar sesión:", err);
        res.redirect("/error?message=Error al iniciar sesión.");
      }
    });

    this.app.get("/fetch-questions", async (req, res) => {
      try {
        const topics = ["geografia", "historia", "naturaleza", "random"];
        await fetchQuestions(topics);
        res.send("Preguntas actualizadas.");
      } catch (error) {
        res.status(500).send("Error al actualizar preguntas.");
      }
    });

    // Ruta para mostrar la tabla de puntuaciones general
    this.app.get("/scores/general", async (req, res) => {
      try {
        const scores = await this.getScores();
        res.render("scores_general", { scores: scores.globalScores });
      } catch (error) {
        res.status(500).send("Error al obtener las puntuaciones.");
      }
    });

    // Ruta para mostrar la tabla de puntuaciones personal
    this.app.get("/scores/personal", async (req, res) => {
      try {
        if (!req.session.username) {
          return res.redirect("/");
        }

        const userId = req.session.username;
        const scores = await this.getScores(userId);
        res.render("scores_personal", { scores: scores.personalScores });
      } catch (error) {
        res.status(500).send("Error al obtener las puntuaciones.");
      }
    });
  }

  listen() {
    this.app.listen(this.port, () => {
      console.log("Servidor ejecutándose en http://127.0.0.1:" + this.port);
    });
  }
}

module.exports = Server;
