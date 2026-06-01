import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth";
import workersRouter from "./routes/workers";
import servicesRouter from "./routes/services";
import categoriesRouter from "./routes/categories";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use("/api/users", usersRouter);
app.use("/api/auth", authRouter);
app.use("/api/workers", workersRouter);
app.use("/api/services", servicesRouter);
app.use("/api/categories", categoriesRouter);


app.listen(PORT, () => {
  console.log(`Servidor a correr em http://localhost:${PORT}`);
});