import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// POST /api/services — cliente cria pedido (SEM pagamento)
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { worker_id, category_id, description, scheduled_at } = req.body;
    const client_id = req.user?.id;

    const [service]: any = await db.query(
      `INSERT INTO services (client_id, worker_id, category_id, description, scheduled_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [client_id, worker_id, category_id ?? null, description, scheduled_at]
    );

    res.status(201).json({ message: "Pedido enviado com sucesso", service_id: service.insertId });
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar pedido" });
  }
});

// GET /api/services/worker
router.get("/worker", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const worker_id = req.user?.id;

    let query = `
      SELECT 
        s.id, s.description, s.scheduled_at, s.status, s.created_at, s.started_at, s.completed_at,
        u.id as client_id, u.name as client_name, u.image as client_image, u.phone as client_phone,
        c.name as category_name
      FROM services s
      INNER JOIN users u ON u.id = s.client_id
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

// GET /api/services/client
router.get("/client", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const client_id = req.user?.id;

    let query = `
      SELECT 
        s.id, s.description, s.scheduled_at, s.status, s.created_at, s.started_at, s.completed_at,
        u.id as worker_id, u.name as worker_name, u.image as worker_image, u.phone as worker_phone,
        wp.specialty, wp.hourly_rate,
        p.id as payment_id, p.amount, p.status as payment_status,
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

// PUT /api/services/:id/accept
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

// PUT /api/services/:id/refuse
router.put("/:id/refuse", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'cancelled' WHERE id = ? AND worker_id = ? AND status = 'pending'`,
      [req.params.id, req.user?.id]
    );
    res.json({ message: "Serviço recusado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao recusar serviço" });
  }
});

// PUT /api/services/:id/start — regista started_at
router.put("/:id/start", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'active', started_at = NOW() WHERE id = ? AND worker_id = ? AND status = 'accepted'`,
      [req.params.id, req.user?.id]
    );
    res.json({ message: "Serviço iniciado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao iniciar serviço" });
  }
});

// PUT /api/services/:id/complete — calcula valor com base nas horas trabalhadas
router.put("/:id/complete", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const worker_id = req.user?.id;
    const service_id = req.params.id;

    // Busca o serviço + hourly_rate do worker
    const [services]: any = await db.query(
      `SELECT s.*, wp.hourly_rate 
       FROM services s
       INNER JOIN worker_profiles wp ON wp.user_id = s.worker_id
       WHERE s.id = ? AND s.worker_id = ? AND s.status = 'active'`,
      [service_id, worker_id]
    );

    if (services.length === 0) {
      res.status(404).json({ error: "Serviço não encontrado ou não está ativo" });
      return;
    }

    const service = services[0];
    const startedAt = new Date(service.started_at);
    const completedAt = new Date();

    // Calcula horas trabalhadas (mínimo 0.25h = 15min para não dar 0)
    const diffMs = completedAt.getTime() - startedAt.getTime();
    const hoursWorked = Math.max(diffMs / (1000 * 60 * 60), 0.25);
    const hourlyRate = parseFloat(service.hourly_rate) || 0;
    const amount = parseFloat((hoursWorked * hourlyRate).toFixed(2));

    // Atualiza o serviço
    await db.query(
      `UPDATE services SET status = 'completed', completed_at = ? WHERE id = ?`,
      [completedAt, service_id]
    );

    // Cria o pagamento PENDENTE (cliente ainda tem de pagar)
    const platformFee = parseFloat((amount * 0.02).toFixed(2));
    const workerEarnings = parseFloat((amount - platformFee).toFixed(2));

    await db.query(
      `INSERT INTO payments (service_id, client_id, worker_id, amount, platform_fee, worker_earnings, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [service_id, service.client_id, worker_id, amount, platformFee, workerEarnings]
    );

    res.json({
      message: "Serviço concluído",
      hoursWorked: hoursWorked.toFixed(2),
      amount,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Erro ao concluir serviço" });
  }
});

// PUT /api/services/:id/cancel — cliente cancela (só se pending)
router.put("/:id/cancel", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `UPDATE services SET status = 'cancelled' WHERE id = ? AND client_id = ? AND status = 'pending'`,
      [req.params.id, req.user?.id]
    );
    res.json({ message: "Pedido cancelado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao cancelar pedido" });
  }
});

export default router;