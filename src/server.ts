import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "http://localhost:5173" })); 
app.use(express.json());

// Rotas
app.use("/api/users", usersRouter);
app.use("/api/auth", authRouter)

app.listen(PORT, () => {
  console.log(`Servidor a correr em http://localhost:${PORT}`);
});