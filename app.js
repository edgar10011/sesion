require("dotenv").config();

// require('./models/mongoClient');

const Server = require("./models/server");

const server = new Server();
server.listen();
