import { Router, Request, Response } from "express";
import db from "../lib/db";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query("SELECT * FROM users");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar utilizadores" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email } = req.body;
    const [result] = await db.query(
      "INSERT INTO users (name, email) VALUES (?, ?)",
      [name, email]
    );
    res.json({ message: "Utilizador criado", result });
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar utilizador" });
  }
});

export default router;