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

// GET /api/admin/payments/overview — visão financeira completa
router.get("/payments/overview", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    // Totais gerais
    const [[totals]]: any = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)          as total_revenue,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN platform_fee END), 0)    as total_fees,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN worker_earnings END), 0) as total_worker_earnings,
        COUNT(CASE WHEN status = 'paid' THEN 1 END)                          as total_paid,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)                       as total_pending,
        COUNT(*)                                                              as total
      FROM payments
    `);

    // Faturação por mês (últimos 6 meses)
    const [monthlyRevenue]: any = await db.query(`
      SELECT
        DATE_FORMAT(paid_at, '%Y-%m') as month,
        DATE_FORMAT(paid_at, '%b %Y') as label,
        SUM(amount)          as revenue,
        SUM(platform_fee)    as fees,
        SUM(worker_earnings) as worker_earnings,
        COUNT(*)             as count
      FROM payments
      WHERE status = 'paid'
        AND paid_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month, label
      ORDER BY month ASC
    `);

    // Faturação por categoria
    const [byCategory]: any = await db.query(`
      SELECT
        c.name as category,
        COUNT(p.id)          as total_services,
        SUM(p.amount)        as revenue,
        SUM(p.platform_fee)  as fees
      FROM payments p
      INNER JOIN services s ON s.id = p.service_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE p.status = 'paid'
      GROUP BY c.name
      ORDER BY revenue DESC
    `);

    // Faturação por cidade (address do worker)
    const [byCity]: any = await db.query(`
      SELECT
        COALESCE(u.address, 'Sem localização') as city,
        COUNT(p.id)   as total_services,
        SUM(p.amount) as revenue
      FROM payments p
      INNER JOIN users u ON u.id = p.worker_id
      WHERE p.status = 'paid'
      GROUP BY city
      ORDER BY revenue DESC
      LIMIT 10
    `);

    // Top workers que mais faturam
    const [topWorkers]: any = await db.query(`
      SELECT
        u.id, u.name, u.image,
        wp.specialty,
        COUNT(p.id)          as total_services,
        SUM(p.worker_earnings) as total_earned
      FROM payments p
      INNER JOIN users u ON u.id = p.worker_id
      LEFT JOIN worker_profiles wp ON wp.user_id = p.worker_id
      WHERE p.status = 'paid'
      GROUP BY u.id, u.name, u.image, wp.specialty
      ORDER BY total_earned DESC
      LIMIT 5
    `);

    // Workers que menos faturam (com pelo menos 1 serviço)
    const [bottomWorkers]: any = await db.query(`
      SELECT
        u.id, u.name, u.image,
        wp.specialty,
        COUNT(p.id)            as total_services,
        SUM(p.worker_earnings) as total_earned
      FROM payments p
      INNER JOIN users u ON u.id = p.worker_id
      LEFT JOIN worker_profiles wp ON wp.user_id = p.worker_id
      WHERE p.status = 'paid'
      GROUP BY u.id, u.name, u.image, wp.specialty
      ORDER BY total_earned ASC
      LIMIT 5
    `);

    // Método de pagamento mais usado
    const [byMethod]: any = await db.query(`
      SELECT
        method,
        COUNT(*) as count,
        SUM(amount) as revenue
      FROM payments
      WHERE status = 'paid'
      GROUP BY method
      ORDER BY count DESC
    `);

    res.json({
      totals: {
        revenue:          parseFloat(totals.total_revenue),
        fees:             parseFloat(totals.total_fees),
        worker_earnings:  parseFloat(totals.total_worker_earnings),
        paid:             totals.total_paid,
        pending:          totals.total_pending,
        total:            totals.total,
      },
      monthlyRevenue: monthlyRevenue.map((r: any) => ({
        ...r,
        revenue:          parseFloat(r.revenue),
        fees:             parseFloat(r.fees),
        worker_earnings:  parseFloat(r.worker_earnings),
      })),
      byCategory: byCategory.map((r: any) => ({
        ...r,
        revenue: parseFloat(r.revenue),
        fees:    parseFloat(r.fees),
      })),
      byCity: byCity.map((r: any) => ({
        ...r,
        revenue: parseFloat(r.revenue),
      })),
      topWorkers: topWorkers.map((r: any) => ({
        ...r,
        total_earned: parseFloat(r.total_earned),
      })),
      bottomWorkers: bottomWorkers.map((r: any) => ({
        ...r,
        total_earned: parseFloat(r.total_earned),
      })),
      byMethod: byMethod.map((r: any) => ({
        ...r,
        revenue: parseFloat(r.revenue),
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar dados financeiros" });
  }
});

// GET /api/admin/services/all — todos os serviços com detalhes
router.get("/services/all", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.query;

    let query = `
      SELECT
        s.id, s.description, s.status, s.scheduled_at, s.created_at, s.started_at, s.completed_at,
        uc.id as client_id, uc.name as client_name, uc.email as client_email,
        uw.id as worker_id, uw.name as worker_name, uw.email as worker_email,
        wp.specialty,
        c.name as category_name,
        p.amount, p.status as payment_status, p.method
      FROM services s
      INNER JOIN users uc ON uc.id = s.client_id
      INNER JOIN users uw ON uw.id = s.worker_id
      LEFT JOIN worker_profiles wp ON wp.user_id = s.worker_id
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN payments p ON p.service_id = s.id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (status) {
      query += " AND s.status = ?";
      params.push(status);
    }

    if (search) {
      query += " AND (uc.name LIKE ? OR uw.name LIKE ? OR s.description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += " ORDER BY s.created_at DESC";

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar serviços" });
  }
});

// GET /api/admin/reports/data — dados para relatórios exportáveis
router.get("/reports/data", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { type } = req.query;

    if (type === "payments") {
      const [rows] = await db.query(`
        SELECT
          p.reference, p.amount, p.platform_fee, p.worker_earnings,
          p.method, p.status, p.paid_at, p.created_at,
          uc.name as cliente, uc.email as email_cliente,
          uw.name as profissional, wp.specialty as especialidade,
          c.name as categoria, s.description as descricao
        FROM payments p
        INNER JOIN users uc ON uc.id = p.client_id
        INNER JOIN users uw ON uw.id = p.worker_id
        LEFT JOIN worker_profiles wp ON wp.user_id = p.worker_id
        INNER JOIN services s ON s.id = p.service_id
        LEFT JOIN categories c ON c.id = s.category_id
        ORDER BY p.created_at DESC
      `);
      res.json(rows);
    } else if (type === "services") {
      const [rows] = await db.query(`
        SELECT
          s.id, s.description as descricao, s.status, s.scheduled_at,
          s.started_at, s.completed_at, s.created_at,
          uc.name as cliente, uc.email as email_cliente,
          uw.name as profissional, wp.specialty as especialidade,
          c.name as categoria,
          p.amount as valor, p.status as status_pagamento
        FROM services s
        INNER JOIN users uc ON uc.id = s.client_id
        INNER JOIN users uw ON uw.id = s.worker_id
        LEFT JOIN worker_profiles wp ON wp.user_id = s.worker_id
        LEFT JOIN categories c ON c.id = s.category_id
        LEFT JOIN payments p ON p.service_id = s.id
        ORDER BY s.created_at DESC
      `);
      res.json(rows);
    } else if (type === "workers") {
      const [rows] = await db.query(`
        SELECT
          u.name as profissional, u.email, u.phone as telefone, u.address as cidade,
          wp.specialty as especialidade, wp.hourly_rate as preco_hora,
          wp.rating_avg as avaliacao, wp.total_earnings as ganhos_totais,
          COUNT(s.id) as total_servicos,
          COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as servicos_concluidos
        FROM users u
        INNER JOIN worker_profiles wp ON wp.user_id = u.id
        LEFT JOIN services s ON s.worker_id = u.id
        WHERE u.role = 'worker'
        GROUP BY u.id, u.name, u.email, u.phone, u.address,
                 wp.specialty, wp.hourly_rate, wp.rating_avg, wp.total_earnings
        ORDER BY ganhos_totais DESC
      `);
      res.json(rows);
    } else {
      res.status(400).json({ error: "Tipo de relatório inválido" });
    }
  } catch (error) {
    res.status(500).json({ error: "Erro ao gerar relatório" });
  }
});

export default router;