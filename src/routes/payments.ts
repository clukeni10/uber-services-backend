import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

router.post("/:service_id/pay", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { service_id } = req.params;
    const { method, card_last4, phone } = req.body;
    const client_id = req.user?.id;

    const [payments]: any = await db.query(
      `SELECT * FROM payments WHERE service_id = ? AND client_id = ? AND status = 'pending'`,
      [service_id, client_id]
    );

    if (payments.length === 0) {
      res.status(404).json({ error: "Pagamento não encontrado ou já processado" });
      return;
    }

    const payment = payments[0];
    const reference = `REF${Date.now().toString().slice(-8)}`;

    await db.query(
      `UPDATE payments SET status = 'paid', paid_at = NOW(), reference = ?, method = ?, card_last4 = ?, phone = ?
       WHERE service_id = ?`,
      [reference, method, card_last4 ?? null, phone ?? null, service_id]
    );

    // Já não muda o status do serviço — já está 'completed'
    await db.query(
      `UPDATE worker_profiles SET total_earnings = total_earnings + ? WHERE user_id = ?`,
      [payment.worker_earnings, payment.worker_id]
    );

    // ... resto igual (gera fatura)
  } catch (error) {
    res.status(500).json({ error: "Erro ao processar pagamento" });
  }
});

// GET /api/payments/invoices/client
router.get("/invoices/client", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*,
              uc.name as client_name, uc.email as client_email,
              uw.name as worker_name, uw.email as worker_email, uw.phone as worker_phone,
              wp.specialty,
              s.scheduled_at, s.description,
              c.name as category_name
       FROM invoices i
       INNER JOIN users uc ON uc.id = i.client_id
       INNER JOIN users uw ON uw.id = i.worker_id
       LEFT JOIN worker_profiles wp ON wp.user_id = i.worker_id
       INNER JOIN services s ON s.id = i.service_id
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE i.client_id = ?
       ORDER BY i.issued_at DESC`,
      [req.user?.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

// GET /api/payments/invoice/:service_id
router.get("/invoice/:service_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `SELECT i.*,
              uc.name as client_name, uc.email as client_email, uc.phone as client_phone, uc.address as client_address,
              uw.name as worker_name, uw.email as worker_email, uw.phone as worker_phone,
              wp.specialty,
              s.scheduled_at, s.description,
              c.name as category_name
       FROM invoices i
       INNER JOIN users uc ON uc.id = i.client_id
       INNER JOIN users uw ON uw.id = i.worker_id
       LEFT JOIN worker_profiles wp ON wp.user_id = i.worker_id
       INNER JOIN services s ON s.id = i.service_id
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE i.service_id = ?`,
      [req.params.service_id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Fatura não encontrada" });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar fatura" });
  }
});

// GET /api/payments/client
router.get("/client", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, s.description, s.scheduled_at, u.name as worker_name
       FROM payments p
       INNER JOIN services s ON s.id = p.service_id
       INNER JOIN users u ON u.id = p.worker_id
       WHERE p.client_id = ?
       ORDER BY p.created_at DESC`,
      [req.user?.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar pagamentos" });
  }
});

// GET /api/payments/invoices/worker
router.get("/invoices/worker", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await db.query(`
      SELECT i.*,
             uc.name as client_name, uc.email as client_email, uc.phone as client_phone, uc.address as client_address,
             uw.name as worker_name, uw.email as worker_email, uw.phone as worker_phone,
             wp.specialty,
             s.scheduled_at, s.description,
             c.name as category_name
      FROM invoices i
      INNER JOIN users uc ON uc.id = i.client_id
      INNER JOIN users uw ON uw.id = i.worker_id
      LEFT JOIN worker_profiles wp ON wp.user_id = i.worker_id
      INNER JOIN services s ON s.id = i.service_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE i.worker_id = ?
      ORDER BY i.issued_at DESC
    `, [req.user?.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

export default router;