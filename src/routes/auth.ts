import { Router, Response, Request } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../lib/db";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
      console.log("BODY:", req.body);
      try {
            const { name, email, password, role } = req.body;

            const [existing]: any = await db.query(
                  "SELECT id FROM users WHERE email = ?",
                  [email]
            );

            if (existing.length > 0) {
                  res.status(400).json({ error: "Email já está em uso" });
                  return;
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const [result]: any = await db.query(
                  "INSERT INTO users (name, email, password, role) VALUES(?, ?, ?, ?)",
                  [name, email, hashedPassword, role ?? "client"]
            );

            // Se for worker, cria o worker_profile automaticamente
            if (role === "worker") {
                  await db.query(
                        "INSERT INTO worker_profiles (user_id) VALUES (?)",
                        [result.insertId]
                  );
            }

            res.status(201).json({ message: "Utilizador criado", id: result.insertId });
      } catch (error) {
            console.error("❌ ERRO DETALHADO NO BACKEND:", error);
            res.status(500).json({ message: "Erro ao criar utilizador" });
      }
});

router.post("/login", async (req: Request, res: Response) => {
      try {
            const { email, password } = req.body;

            const [rows]: any = await db.query(
                  "SELECT * FROM users WHERE email=?", [email]
            );

            if (rows.length === 0) {
                  res.status(401).json({ error: "Email ou password incorretos" });
                  return;
            }
            const user = rows[0];

            // ADICIONA ESTES LOGS PARA DETETAR O ERRO:
            console.log("Password digitada no formulário:", password);
            console.log("Hash que veio da Base de Dados:", user.password);
            console.log("O tamanho da Hash na BD é:", user.password.length);

            const passwordMatch = await bcrypt.compare(password, user.password);

            if (!passwordMatch) {
                  res.status(401).json({ error: "Email ou password incorretos" });
                  return;
            }

            const token = jwt.sign(
                  {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                  },
                  process.env.JWT_SECRET as string,
                  { expiresIn: "7d" }
            );

            res.json({
                  token,
                  user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role,
                  },
            });
      } catch (error) {
            res.status(500).json({ error: "Erro no servidor" });
      }
});



export default router;