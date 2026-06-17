import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// POST /api/services — cliente cria pedido
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { worker_id, category_id, description, scheduled_at, amount, method } = req.body;
    const client_id = req.user?.id;

    const [service]: any = await db.query(
      `INSERT INTO services (client_id, worker_id, category_id, description, scheduled_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [client_id, worker_id, category_id ?? null, description, scheduled_at]
    );

    const service_id = service.insertId;

    await db.query(
      `INSERT INTO payments (service_id, client_id, worker_id, amount, method, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [service_id, client_id, worker_id, amount, method]
    );

    res.status(201).json({ message: "Serviço criado com sucesso", service_id });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Erro ao criar serviço" });
  }
});

// GET /api/services/worker — worker vê os seus serviços
router.get("/worker", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const worker_id = req.user?.id;

    let query = `
      SELECT 
        s.id, s.description, s.scheduled_at, s.status, s.created_at,
        u.id as client_id, u.name as client_name, u.image as client_image, u.phone as client_phone,
        p.amount, p.method, p.status as payment_status,
        c.name as category_name
      FROM services s
      INNER JOIN users u ON u.id = s.client_id
      LEFT JOIN payments p ON p.service_id = s.id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE s.worker_id = ?
    `;

    const params: any[] = [worker_id];

    if (status) {
      query += " AND s.status = ?";
      params.push(status);
    }

    query += " ORDER BY s.created_at DESC";

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar serviços" });
  }
});

// GET /api/services/client — cliente vê os seus serviços
router.get("/client", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const client_id = req.user?.id;

    let query = `
      SELECT 
        s.id, s.description, s.scheduled_at, s.status, s.created_at,
        u.id as worker_id, u.name as worker_name, u.image as worker_image, u.phone as worker_phone,
        wp.specialty,
        p.amount, p.method, p.status as payment_status,
        c.name as category_name
      FROM services s
      INNER JOIN users u ON u.id = s.worker_id
      LEFT JOIN worker_profiles wp ON wp.user_id = s.worker_id
      LEFT JOIN payments p ON p.service_id = s.id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE s.client_id = ?
    `;

    const params: any[] = [client_id];

    if (status) {
      query += " AND s.status = ?";
      params.push(status);
    }

    query += " ORDER BY s.created_at DESC";

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar serviços" });
  }
});

// PUT /api/services/:id/accept — worker aceita
router.put("/:id/accept", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'accepted' WHERE id = ? AND worker_id = ? AND status = 'pending'`,
      [req.params.id, req.user?.id]
    );
    res.json({ message: "Serviço aceite" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao aceitar serviço" });
  }
});

// PUT /api/services/:id/refuse — worker recusa
router.put("/:id/refuse", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'cancelled' WHERE id = ? AND worker_id = ? AND status = 'pending'`,
      [req.params.id, req.user?.id]
    );
    await db.query(
      `UPDATE payments SET status = 'failed' WHERE service_id = ?`,
      [req.params.id]
    );
    res.json({ message: "Serviço recusado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao recusar serviço" });
  }
});

// PUT /api/services/:id/start — worker inicia
router.put("/:id/start", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'active' WHERE id = ? AND worker_id = ? AND status = 'accepted'`,
      [req.params.id, req.user?.id]
    );
    res.json({ message: "Serviço iniciado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao iniciar serviço" });
  }
});

// PUT /api/services/:id/complete — worker conclui + dispara pagamento
router.put("/:id/complete", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const worker_id = req.user?.id;

    // Atualiza status do serviço
    await db.query(
      `UPDATE services SET status = 'completed' WHERE id = ? AND worker_id = ? AND status = 'active'`,
      [req.params.id, worker_id]
    );

    // Busca o pagamento
    const [payments]: any = await db.query(
      `SELECT * FROM payments WHERE service_id = ?`,
      [req.params.id]
    );

    if (payments.length > 0) {
      const payment = payments[0];

      // Atualiza pagamento para paid
      await db.query(
        `UPDATE payments SET status = 'paid', paid_at = NOW() WHERE service_id = ?`,
        [req.params.id]
      );

      // Atualiza total_earnings do worker
      await db.query(
        `UPDATE worker_profiles SET total_earnings = total_earnings + ? WHERE user_id = ?`,
        [payment.worker_earnings, worker_id]
      );
    }

    res.json({ message: "Serviço concluído" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao concluir serviço" });
  }
});

// PUT /api/services/:id/cancel — cliente cancela
router.put("/:id/cancel", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'cancelled' WHERE id = ? AND client_id = ? AND status = 'pending'`,
      [req.params.id, req.user?.id]
    );
    await db.query(
      `UPDATE payments SET status = 'failed' WHERE service_id = ?`,
      [req.params.id]
    );
    res.json({ message: "Serviço cancelado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao cancelar serviço" });
  }
});

export default router;