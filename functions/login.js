// const bcrypt = require("bcrypt");

const users = [
  {
    id: 1,
    username: "key",
    email: "key@gmail.com",
    password: "key123",
  },
  {
    id: 2,
    username: "monse",
    email: "monse@gmail.com",
    password: "monse123",
  },
];

function login(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { usernameOrEmail, password } = req.query;
  const user = users.find(
    (u) => u.username === usernameOrEmail || u.email === usernameOrEmail
  );

  const pass = users.find(
    (u) => u.password === password
  );
  if (user && pass) {
    let mensaje = "Usuario ha accedido a login";
    res.json({ status: "success", data: "Credenciales Correctas" });
  } else {
    res.status(400).send("Ingresa nombre de usuario y contraseña" + usernameOrEmail + password);
  }
}

module.exports = login;
