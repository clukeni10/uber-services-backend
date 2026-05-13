import { Router, Response, Request } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../lib/db";

const router = Router();

router.post("/login", async (req: Request, res: Response) => {
      try {
            const { email, password } = req.body;

            const rows[]: any = await db.query(
                  "SELECT * FROM users WHERE email=?", [email]
            );

            if (rows.length === 0) {
                  res.status(401).json({ error: "Email ou password incorretos" });
                  return;
            }

            const user = rows[0];

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