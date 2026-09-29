const pool = require('./config/db');
const bcrypt = require('bcryptjs');

async function seed() {
  try {
    // Tài khoản admin demo cho bảo vệ: admin@webnovel.app / admin123
    const adminHash = await bcrypt.hash('admin123', 10);
    await pool.query(
      "INSERT INTO users(username, email, password_hash, role, coins) VALUES('admin','admin@webnovel.app',$1,'admin',1000) ON CONFLICT (email) DO UPDATE SET role='admin'",
      [adminHash]
    );
    const cats = ['Thanh pho', 'Huyen huyen', 'Kinh di', 'Ngon tinh', 'Tien hiep', 'Dong phuong', 'Hien thuc', 'Chung'];
    const slugOf = (s) => s.toLowerCase().replace(/\s+/g, '-');
    for (const name of cats) {
      await pool.query('INSERT INTO categories(name, slug) VALUES($1,$2) ON CONFLICT DO NOTHING', [name, slugOf(name)]);
    }
    const catRows = await pool.query('SELECT * FROM categories');
    const catMap = {};
    catRows.rows.forEach((c) => { catMap[c.name] = c.id; });

    const novels = [
      { title: 'Quy Xa', author: 'Forlan_White', cat: 'Kinh di', views: 95000, rating: 4.7, ago: 1, desc: 'Ngoi nha quy am voi bi an kinh hoang.' },
      { title: 'Tu Chan Lieu Thien Quan', author: 'Thanh Pho Sach', cat: 'Huyen huyen', views: 78000, rating: 4.6, ago: 0, desc: 'Group chat cua cac tu chan gia.' },
      { title: 'Vo Boss La Than Y', author: 'Nguyet Ha', cat: 'Ngon tinh', views: 88000, rating: 4.6, ago: 0, desc: 'Co vo bi coi thuong hoa ra la than y an danh.' },
      { title: 'Kiem Dao Doc Ton', author: 'Lang Tieu', cat: 'Tien hiep', views: 72000, rating: 4.5, ago: 2, desc: 'Mot kiem pha van phap, thieu nien phe vat quat khoi.' },
      { title: 'Trong Sinh Do Thi Cuong Long', author: 'Tran Phong', cat: 'Dong phuong', views: 60000, rating: 4.3, ago: 10, desc: 'Long vuong trong sinh ve thoi nien thieu.' },
      { title: 'Toan Dan Linh Chu', author: 'Mac Van', cat: 'Huyen huyen', views: 52000, rating: 4.4, ago: 1, desc: 'Xuyen vao the gioi linh chu, mo thien phu than cap.' },
      { title: 'Duy nhat la em', author: 'Tac gia A', cat: 'Thanh pho', views: 55000, rating: 4.4, ago: 3, desc: 'Chi co em la duy nhat trong doi anh.' },
      { title: 'Dac Cong Vuon Truong', author: 'Chung', cat: 'Chung', views: 45000, rating: 4.0, ago: 8, desc: 'Nu dac cong tron vao vuon truong.' },
      { title: 'Co Vo Ngot Ngao Cua Tong Tai', author: 'Ha An', cat: 'Ngon tinh', views: 40000, rating: 4.0, ago: 20, desc: 'Hop dong hon nhan 1 nam, ai ngo tong tai that long.' },
      { title: 'Truong Sinh Mot Doi Binh Pham', author: 'Hoang Huy', cat: 'Huyen huyen', views: 30000, rating: 4.1, ago: 15, desc: 'Hanh trinh truong sinh giua the gian binh pham.' },
      { title: 'Am Duong Quan Tro', author: 'Da Quy', cat: 'Kinh di', views: 25000, rating: 4.2, ago: 5, desc: 'Quan tro chi mo luc nua dem.' },
      { title: 'Hoc Ba Xuyen Thanh Phao Hoi', author: 'To Le', cat: 'Hien thuc', views: 18000, rating: 4.1, ago: 0, desc: 'Hoc ba xuyen sach thanh nu phu phao hoi.' },
    ];

    for (let k = 0; k < novels.length; k++) {
      const n = novels[k];
      const exists = await pool.query('SELECT id FROM novels WHERE title=$1', [n.title]);
      let novelId;
      if (exists.rows.length > 0) {
        novelId = exists.rows[0].id;
        await pool.query('UPDATE novels SET total_views=$1, rating=$2, power_votes=$3 WHERE id=$4',
          [n.views, n.rating, Math.floor(n.views / 500), novelId]);
      } else {
        const catId = catMap[n.cat] || null;
        const cover = 'https://picsum.photos/seed/novel' + (k + 1) + '/300/400';
        const res = await pool.query(
          'INSERT INTO novels(title, author, description, cover_url, category_id, total_views, rating, power_votes, status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [n.title, n.author, n.desc, cover, catId, n.views, n.rating, Math.floor(n.views / 500), 'ongoing']
        );
        novelId = res.rows[0].id;
        const chapNames = ['Khoi dau', 'Gap go', 'Bien co', 'Cao trao', 'Bi mat (VIP)', 'Lat keo (VIP)'];
        for (let i = 1; i <= 6; i++) {
          const locked = i >= 5;
          const chapTitle = 'Chuong ' + i + ': ' + chapNames[i - 1];
          const chapBody = ('Noi dung chuong ' + i + ' cua truyen ' + n.title + '. ' + n.desc + ' Dien bien hap dan. ').repeat(10);
          await pool.query(
            'INSERT INTO chapters(novel_id, chapter_number, title, content, is_locked, price_coins) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
            [novelId, i, chapTitle, chapBody, locked, locked ? 20 : 0]
          );
        }
      }
      await pool.query("UPDATE novels SET updated_at = NOW() - ($1 || ' days')::interval WHERE id=$2", [String(n.ago), novelId]);
    }
    console.log('Seed done (12 novels)');
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
seed();
