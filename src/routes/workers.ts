import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import db from "../lib/db";

const router = Router();

// GET /api/workers/me — TEM DE VIR PRIMEIRO
router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
      console.log("GET /worker chamado, user id:", req.user?.id);

    try {
        const [rows]: any = await db.query(
            `SELECT u.id, u.name, u.email, u.phone, u.address, u.birthday, u.image,
              wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available, wp.total_earnings
       FROM users u
       INNER JOIN worker_profiles wp ON wp.user_id = u.id
       WHERE u.id = ?`,
            [req.user?.id]
        );

        if (rows.length === 0) {
            res.status(404).json({ error: "Worker não encontrado" });
            return;
        }

        const w = rows[0];
        res.json({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
            total_earnings: w.total_earnings ? parseFloat(w.total_earnings) : 0,
        });
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar perfil" });
    }
});

// GET /api/workers/earnings
router.get("/earnings", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const worker_id = req.user?.id;

    // Totais gerais
    const [[totals]]: any = await db.query(`
      SELECT
        COALESCE(SUM(amount), 0)          as gross_total,
        COALESCE(SUM(platform_fee), 0)    as fees_total,
        COALESCE(SUM(worker_earnings), 0) as net_total,
        COUNT(*)                          as total_payments
      FROM payments
      WHERE worker_id = ? AND status = 'paid'
    `, [worker_id]);

    // Ganhos do mês atual
    const [[currentMonth]]: any = await db.query(`
      SELECT
        COALESCE(SUM(amount), 0)          as gross,
        COALESCE(SUM(platform_fee), 0)    as fees,
        COALESCE(SUM(worker_earnings), 0) as net,
        COUNT(*)                          as count
      FROM payments
      WHERE worker_id = ? AND status = 'paid'
        AND MONTH(paid_at) = MONTH(NOW()) AND YEAR(paid_at) = YEAR(NOW())
    `, [worker_id]);

    // Ganhos do mês anterior (para comparação)
    const [[lastMonth]]: any = await db.query(`
      SELECT COALESCE(SUM(worker_earnings), 0) as net
      FROM payments
      WHERE worker_id = ? AND status = 'paid'
        AND MONTH(paid_at) = MONTH(NOW() - INTERVAL 1 MONTH)
        AND YEAR(paid_at) = YEAR(NOW() - INTERVAL 1 MONTH)
    `, [worker_id]);

    // Histórico mensal (últimos 6 meses)
    const [monthly]: any = await db.query(`
      SELECT
        DATE_FORMAT(paid_at, '%Y-%m') as month,
        DATE_FORMAT(paid_at, '%b') as label,
        SUM(amount)          as gross,
        SUM(platform_fee)    as fees,
        SUM(worker_earnings) as net,
        COUNT(*)              as count
      FROM payments
      WHERE worker_id = ? AND status = 'paid'
        AND paid_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month, label
      ORDER BY month ASC
    `, [worker_id]);

    // Histórico de pagamentos detalhado
    const [history]: any = await db.query(`
      SELECT
        p.id, p.reference, p.amount, p.platform_fee, p.worker_earnings,
        p.method, p.paid_at,
        uc.name as client_name, uc.image as client_image,
        s.description, c.name as category_name
      FROM payments p
      INNER JOIN users uc ON uc.id = p.client_id
      INNER JOIN services s ON s.id = p.service_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE p.worker_id = ? AND p.status = 'paid'
      ORDER BY p.paid_at DESC
      LIMIT 20
    `, [worker_id]);

    const monthGrowth = lastMonth.net > 0
      ? ((parseFloat(currentMonth.net) - parseFloat(lastMonth.net)) / parseFloat(lastMonth.net)) * 100
      : 0;

    res.json({
      totals: {
        gross:    parseFloat(totals.gross_total),
        fees:     parseFloat(totals.fees_total),
        net:      parseFloat(totals.net_total),
        payments: totals.total_payments,
      },
      currentMonth: {
        gross: parseFloat(currentMonth.gross),
        fees:  parseFloat(currentMonth.fees),
        net:   parseFloat(currentMonth.net),
        count: currentMonth.count,
        growth: parseFloat(monthGrowth.toFixed(1)),
      },
      monthly: monthly.map((m: any) => ({
        ...m,
        gross: parseFloat(m.gross),
        fees:  parseFloat(m.fees),
        net:   parseFloat(m.net),
      })),
      history,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar rendimentos" });
  }
});

// PUT /api/workers/me
router.put("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
    console.log("image size:", req.body.image?.length ?? 0);
    try {
        const { name, email, phone, address, birthday, image, specialty, bio, hourly_rate, is_available } = req.body;

        await db.query(
            `UPDATE users SET name=?, email=?, phone=?, address=?, birthday=?, image=? WHERE id=?`,
            [name, email, phone, address, birthday, image, req.user?.id]
        );

        await db.query(
            `UPDATE worker_profiles SET specialty=?, bio=?, hourly_rate=?, is_available=? WHERE user_id=?`,
            [specialty, bio, hourly_rate, is_available, req.user?.id]
        );

        res.json({ message: "Perfil atualizado com sucesso" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Erro ao atualizar perfil" });
    }
});

// GET /api/workers/category/:name — workers por categoria
router.get("/category/:name", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const [rows]: any = await db.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.image,
        wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available
      FROM users u
      INNER JOIN worker_profiles wp ON wp.user_id = u.id
      WHERE u.role = 'worker' AND wp.specialty = ? AND wp.is_available = true
      ORDER BY wp.rating_avg DESC
    `, [req.params.name]);

        const workers = (rows as any[]).map((w) => ({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
        }));

        res.json(workers);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar workers por categoria" });
    }
});

// GET /api/workers/stats
router.get("/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const worker_id = req.user?.id;

    const [[services]]: any = await db.query(`
      SELECT
        COUNT(*) as total_services,
        SUM(status = 'pending')   as pending,
        SUM(status = 'accepted')  as accepted,
        SUM(status = 'active')    as active,
        SUM(status = 'completed') as completed,
        SUM(status = 'cancelled') as cancelled
      FROM services
      WHERE worker_id = ?
    `, [worker_id]);

    const [[earnings]]: any = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN worker_earnings ELSE 0 END), 0) as total_earnings,
        COALESCE(SUM(CASE WHEN status = 'paid' AND MONTH(paid_at) = MONTH(NOW()) AND YEAR(paid_at) = YEAR(NOW()) THEN worker_earnings ELSE 0 END), 0) as month_earnings
      FROM payments
      WHERE worker_id = ?
    `, [worker_id]);

    const [[rating]]: any = await db.query(`
      SELECT COALESCE(AVG(rating), 0) as avg_rating, COUNT(*) as total_reviews
      FROM reviews
      WHERE worker_id = ?
    `, [worker_id]);

    const [recentServices]: any = await db.query(`
      SELECT s.id, s.description, s.status, s.created_at, s.started_at,
             u.name as client_name, u.image as client_image
      FROM services s
      INNER JOIN users u ON u.id = s.client_id
      WHERE s.worker_id = ?
      ORDER BY s.created_at DESC
      LIMIT 5
    `, [worker_id]);

    res.json({
      services: {
        total:     services.total_services,
        pending:   services.pending,
        accepted:  services.accepted,
        active:    services.active,
        completed: services.completed,
        cancelled: services.cancelled,
      },
      earnings: {
        total: parseFloat(earnings.total_earnings),
        month: parseFloat(earnings.month_earnings),
      },
      rating: {
        avg:     parseFloat(earnings.avg_rating ?? 0),
        reviews: rating.total_reviews,
      },
      recentServices,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
});

// GET /api/workers/filters
router.get("/filters", async (req: AuthRequest, res: Response) => {
  try {
    // 1. Busca especialidades diretamente dos perfis existentes
    const [specialtiesRows]: any = await db.query(
      "SELECT DISTINCT specialty FROM worker_profiles WHERE specialty IS NOT NULL AND specialty != ''"
    );
    
    // 2. Busca os endereços brutos de quem é worker
    const [addressesRows]: any = await db.query(
      "SELECT DISTINCT address FROM users WHERE role = 'worker' AND address IS NOT NULL AND address != ''"
    );

    // 3. Formata as Categorias (Primeira letra maiúscula para ficar bonito na UI)
    const categories = (specialtiesRows as any[]).map(row => {
      const original = row.specialty;
      const formatado = original.charAt(0).toUpperCase() + original.slice(1).toLowerCase();
      return {
        label: formatado, // Ex: "Electricista"
        value: original.toLowerCase() // Ex: "electricista" (combina com o banco)
      };
    });

    // 4. Trata e limpa os Municípios de Luanda
    const citiesMap = new Map();
    
    (addressesRows as any[]).forEach(row => {
      // Se o endereço for "Viana, Luanda", separa pela vírgula e pega o "Viana"
      const parts = row.address.split(",");
      const rawCity = parts[0].trim(); 
      
      if (rawCity) {
        const label = rawCity.charAt(0).toUpperCase() + rawCity.slice(1).toLowerCase();
        const value = rawCity.toLowerCase();
        
        // O Map evita duplicados automaticamente
        citiesMap.set(value, { label, value });
      }
    });

    const cities = Array.from(citiesMap.values());

    // Retorna a estrutura exata que o frontend espera
    res.json({ categories, cities });
  } catch (error) {
    console.error("Erro na rota de filtros:", error);
    res.status(500).json({ error: "Erro ao carregar filtros dinâmicos" });
  }
});

// GET /api/workers/:id
router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const [rows]: any = await db.query(
            `SELECT u.id, u.name, u.email, u.phone, u.address, u.image,
              wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available
       FROM users u
       INNER JOIN worker_profiles wp ON wp.user_id = u.id
       WHERE u.id = ? AND u.role = 'worker'`,
            [req.params.id]
        );

        if (rows.length === 0) {
            res.status(404).json({ error: "Profissional não encontrado" });
            return;
        }

        const w = rows[0];
        res.json({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
        });
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar profissional" });
    }
});

// GET /api/workers — FICA POR ÚLTIMO
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { search, category, city } = req.query;

        let query = `
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.image,
        wp.specialty, wp.bio, wp.hourly_rate, wp.rating_avg, wp.is_available
      FROM users u
      INNER JOIN worker_profiles wp ON wp.user_id = u.id
      WHERE u.role = 'worker'
    `;

        const params: any[] = [];

        if (search) {
            query += " AND (u.name LIKE ? OR wp.specialty LIKE ?)";
            params.push(`%${search}%`, `%${search}%`);
        }

        if (category) {
            query += " AND wp.specialty = ?";
            params.push(category);
        }

        if (city) {
            query += " AND u.address LIKE ?";
            params.push(`%${city}%`);
        }

        query += " ORDER BY wp.rating_avg DESC";

        const [rows]: any = await db.query(query, params);
        const workers = (rows as any[]).map((w) => ({
            ...w,
            rating_avg: w.rating_avg ? parseFloat(w.rating_avg) : null,
            hourly_rate: w.hourly_rate ? parseFloat(w.hourly_rate) : null,
        }));
        res.json(workers);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar profissionais" });
    }
});



export default router;