import { Router, Response, Request } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../lib/db";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
      console.log("BODY REGISTER:", req.body);
      try {
            const { name, email, password, role } = req.body;

            // Validação simples para evitar quebras no bcrypt
            if (!email || !password) {
                  res.status(400).json({ error: "Email e password são obrigatórios" });
                  return;
            }

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

            if (role === "worker") {
                  await db.query(
                        "INSERT INTO worker_profiles (user_id) VALUES (?)",
                        [result.insertId]
                  );
            }

            res.status(201).json({ message: "Utilizador criado", id: result.insertId });
      } catch (error) {
            console.error("❌ ERRO DETALHADO NO REGISTER:", error);
            res.status(500).json({ message: "Erro ao criar utilizador" });
      }
});

router.post("/login", async (req: Request, res: Response) => {
      console.log("BODY LOGIN:", req.body);
      try {
            const { email, password } = req.body;

            // Evita que o bcrypt quebre se o frontend enviar campos vazios
            if (!email || !password) {
                  res.status(400).json({ error: "Email e password são obrigatórios" });
                  return;
            }

            const [rows]: any = await db.query(
                  "SELECT * FROM users WHERE email=?", [email]
            );

            if (rows.length === 0) {
                  res.status(401).json({ error: "Email ou password incorretos" });
                  return;
            }
            const user = rows[0];

            console.log("Password digitada no formulário:", password);
            console.log("Hash que veio da Base de Dados:", user.password);

            // Se a senha na BD for nula ou inválida, gera erro controlado
            if (!user.password) {
                  res.status(401).json({ error: "Dados de utilizador corrompidos" });
                  return;
            }

            const passwordMatch = await bcrypt.compare(password, user.password);

            if (!passwordMatch) {
                  res.status(401).json({ error: "Email ou password incorretos" });
                  return;
            }

            // Fallback caso esqueça de configurar o arquivo .env
            const secret = process.env.JWT_SECRET || "SUPER_SECRET_FALLBACK_KEY_123";
            
            if (!process.env.JWT_SECRET) {
                  console.warn("⚠️ AVISO: JWT_SECRET não está definido no .env! Usando chave de emergência.");
            }

            const token = jwt.sign(
                  {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                  },
                  secret,
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
            // ESSA LINHA É A MAIS IMPORTANTE: Vai mostrar o erro real no terminal do VS Code/Node
            console.error("❌ ERRO DETALHADO NO LOGIN:", error);
            res.status(500).json({ error: "Erro interno no servidor" });
      }
});

export default router;
