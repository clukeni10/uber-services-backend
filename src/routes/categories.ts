import { Router, Response, Request } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// GET /api/categories — lista categorias com contagem de workers
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const [rows] = await db.query(`
      SELECT 
        c.id, c.name, c.icon,
        COUNT(wp.user_id) as worker_count
      FROM categories c
      LEFT JOIN worker_profiles wp ON wp.specialty = c.name AND wp.is_available = true
      LEFT JOIN users u ON u.id = wp.user_id AND u.role = 'worker'
      GROUP BY c.id, c.name, c.icon
      ORDER BY c.name ASC
    `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar categorias" });
    }
});

export default router;