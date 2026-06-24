import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// POST /api/reviews — cliente avalia worker
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { service_id, rating, comment } = req.body;
    const client_id = req.user?.id;

    if (!rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: "Avaliação deve ser entre 1 e 5" });
      return;
    }

    // Verifica se o serviço pertence ao cliente e está pago
    const [services]: any = await db.query(
      `SELECT s.*, p.status as payment_status
       FROM services s
       INNER JOIN payments p ON p.service_id = s.id
       WHERE s.id = ? AND s.client_id = ? AND s.status = 'completed' AND p.status = 'paid'`,
      [service_id, client_id]
    );

    if (services.length === 0) {
      res.status(400).json({ error: "Só podes avaliar serviços concluídos e pagos" });
      return;
    }

    const service = services[0];

    // Verifica se já avaliou
    const [existing]: any = await db.query(
      `SELECT id FROM reviews WHERE service_id = ? AND client_id = ?`,
      [service_id, client_id]
    );

    if (existing.length > 0) {
      res.status(400).json({ error: "Já avaliaste este serviço" });
      return;
    }

    // Cria a avaliação
    await db.query(
      `INSERT INTO reviews (service_id, client_id, worker_id, rating, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [service_id, client_id, service.worker_id, rating, comment ?? null]
    );

    // Recalcula rating_avg do worker
    await db.query(
      `UPDATE worker_profiles
       SET rating_avg = (
         SELECT AVG(rating) FROM reviews WHERE worker_id = ?
       )
       WHERE user_id = ?`,
      [service.worker_id, service.worker_id]
    );

    res.json({ message: "Avaliação submetida com sucesso" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao submeter avaliação" });
  }
});

// GET /api/reviews/worker/:id — avaliações de um worker
router.get("/worker/:id", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.name as client_name, u.image as client_image
       FROM reviews r
       INNER JOIN users u ON u.id = r.client_id
       WHERE r.worker_id = ?
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar avaliações" });
  }
});

export default router;