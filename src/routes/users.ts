import { Router, Request, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

//Buscar dados do user logado
router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query("SELECT id, name, email, phone, address, birthday, role, image, created_at FROM users WHERE id=?", [req.user?.id]);

    if (rows.length === 0) {
      res.status(404).json({ error: "Utilizador não encontrado" });
      return;
    }
    res.json(rows[0]);
  } catch (error) {
     console.log("ERRO:", error);
    res.status(500).json("Erro ao buscar utilizador");
  }
})

//Atualizar dados do user
router.put("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, phone, address, birthday, image } = req.body;

    await db.query(
      `UPDATE users 
       SET name = ?, email = ?, phone = ?, address = ?, birthday = ?, image = ?
       WHERE id = ?`,
      [name, email, phone, address, birthday, image, req.user?.id]
    );

    res.json({ message: "Perfil atualizado com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
});




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