import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";
import bcrypt from "bcrypt";

const router = Router();

// Middleware para verificar se é admin
function adminOnly(req: AuthRequest, res: Response, next: any) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  next();
}

// GET /api/admin/ — todos os utilizadores
router.get("/", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, phone, address, birthday, role, image, created_at FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar utilizadores" });
  }
});

// GET /api/admin/stats — estatísticas gerais
router.get("/stats", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const [[totals]]: any = await db.query(`
      SELECT
        COUNT(*) as total_users,
        SUM(role = 'client') as total_clients,
        SUM(role = 'worker') as total_workers,
        SUM(role = 'admin') as total_admins
      FROM users
    `);

    const [[services]]: any = await db.query(`
      SELECT
        COUNT(*) as total_services,
        SUM(status = 'pending')   as pending,
        SUM(status = 'active')    as active,
        SUM(status = 'completed') as completed,
        SUM(status = 'cancelled') as cancelled
      FROM services
    `);

    const [[payments]]: any = await db.query(`
      SELECT
        COUNT(*) as total_payments,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN platform_fee ELSE 0 END), 0) as total_fees
      FROM payments
    `);

    const [monthlyUsers]: any = await db.query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as count
      FROM users
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month
      ORDER BY month ASC
    `);

    const [monthlyRevenue]: any = await db.query(`
      SELECT 
        DATE_FORMAT(paid_at, '%Y-%m') as month,
        SUM(amount) as revenue
      FROM payments
      WHERE status = 'paid' AND paid_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month
      ORDER BY month ASC
    `);

    res.json({
      users: {
        total: totals.total_users,
        clients: totals.total_clients,
        workers: totals.total_workers,
        admins: totals.total_admins,
      },
      services: {
        total: services.total_services,
        pending: services.pending,
        active: services.active,
        completed: services.completed,
        cancelled: services.cancelled,
      },
      payments: {
        total: payments.total_payments,
        revenue: parseFloat(payments.total_revenue),
        fees: parseFloat(payments.total_fees),
      },
      monthlyUsers,
      monthlyRevenue,
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
});

// GET /api/admin/:id
router.get("/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `SELECT id, name, email, phone, address, birthday, role, image, created_at FROM users WHERE id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Utilizador não encontrado" });
      return;
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar utilizador" });
  }
});

// POST /api/admin/ — criar utilizador
router.post("/", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, phone, address, birthday, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const [result]: any = await db.query(
      `INSERT INTO users (name, email, password, phone, address, birthday, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, hashedPassword, phone ?? null, address ?? null, birthday ?? null, role ?? "client"]
    );

    if (role === "worker") {
      await db.query(`INSERT INTO worker_profiles (user_id) VALUES (?)`, [result.insertId]);
    }

    res.status(201).json({ message: "Utilizador criado", userId: result.insertId });
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar utilizador" });
  }
});

// PUT /api/admin/:id — atualizar utilizador
router.put("/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, phone, address, birthday, role, password } = req.body;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE users SET name=?, email=?, phone=?, address=?, birthday=?, role=?, password=? WHERE id=?`,
        [name, email, phone, address, birthday, role, hashedPassword, req.params.id]
      );
    } else {
      await db.query(
        `UPDATE users SET name=?, email=?, phone=?, address=?, birthday=?, role=? WHERE id=?`,
        [name, email, phone, address, birthday, role, req.params.id]
      );
    }

    res.json({ message: "Utilizador atualizado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar utilizador" });
  }
});

// DELETE /api/admin/:id — eliminar utilizador
router.delete("/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    await db.query(`DELETE FROM users WHERE id = ?`, [req.params.id]);
    res.json({ message: "Utilizador eliminado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao eliminar utilizador" });
  }
});

// GET /api/admin/invoices/all — todas as faturas
router.get("/invoices/all", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await db.query(`
      SELECT i.*,
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
      ORDER BY i.issued_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
});

export default router;