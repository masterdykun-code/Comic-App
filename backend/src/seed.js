const pool = require('./config/db');
const bcrypt = require('bcryptjs');

// Chuẩn hóa slug có dấu -> không dấu (vd: 'Tiên Hiệp' -> 'tien-hiep')
const slugOf = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');

async function seed() {
  try {
    // 0. Chống trùng truyện về sau (idempotent)
    await pool.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novels_title_unique') THEN
          ALTER TABLE novels ADD CONSTRAINT novels_title_unique UNIQUE(title);
        END IF;
      END $$;`);

    // 1. Admin ComicApp: gom email cũ -> mới TRƯỚC khi insert để không kẹt UNIQUE(username).
    // Luôn reset mật khẩu về admin123 để demo/bảo vệ không bị kẹt.
    const adminHash = await bcrypt.hash('admin123', 10);
    const oldAdmin = await pool.query(`SELECT id FROM users WHERE email='admin@webnovel.app'`);
    const newAdmin = await pool.query(`SELECT id FROM users WHERE email='admin@comicapp.app'`);
    if (oldAdmin.rows.length > 0 && newAdmin.rows.length === 0) {
      await pool.query(
        `UPDATE users SET email='admin@comicapp.app', role='admin', password_hash=$1, username='admin'
         WHERE email='admin@webnovel.app'`, [adminHash]);
    } else if (oldAdmin.rows.length > 0 && newAdmin.rows.length > 0
      && oldAdmin.rows[0].id !== newAdmin.rows[0].id) {
      // Đã có cả 2 dòng: chuyển truyện của bản cũ sang bản mới rồi xóa bản cũ
      await pool.query('UPDATE novels SET owner_id=$1 WHERE owner_id=$2',
        [newAdmin.rows[0].id, oldAdmin.rows[0].id]);
      await pool.query(`DELETE FROM users WHERE email='admin@webnovel.app'`);
    }
    await pool.query(
      `INSERT INTO users(username, email, password_hash, role, coins)
       VALUES('admin','admin@comicapp.app',$1,'admin',1000)
       ON CONFLICT (email) DO UPDATE SET role='admin', password_hash=EXCLUDED.password_hash`,
      [adminHash]);

    // 2. Thể loại: UPDATE tại chỗ (giữ FK) thay vì INSERT mới gây trùng
    const cats = [
      { old: 'Thanh pho', name: 'Đô Thị' },
      { old: 'Huyen huyen', name: 'Huyền Huyễn' },
      { old: 'Kinh di', name: 'Kinh Dị' },
      { old: 'Ngon tinh', name: 'Ngôn Tình' },
      { old: 'Tien hiep', name: 'Tiên Hiệp' },
      { old: 'Dong phuong', name: 'Đông Phương' },
      { old: 'Hien thuc', name: 'Hiện Thực' },
      { old: 'Chung', name: 'Hành Động' },
    ];
    for (const c of cats) {
      const slug = slugOf(c.name);
      const r = await pool.query(
        'UPDATE categories SET name=$1, slug=$2 WHERE name=$3 OR slug=$4',
        [c.name, slug, c.old, slugOf(c.old)]);
      if (r.rowCount === 0) {
        await pool.query(
          'INSERT INTO categories(name, slug) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [c.name, slug]);
      }
    }
    const catRows = await pool.query('SELECT * FROM categories');
    const catMap = {};
    catRows.rows.forEach((c) => { catMap[c.name] = c.id; });

    // 3. Truyện: đủ dấu tiếng Việt, tìm theo tên cũ HOẶC mới -> không bao giờ trùng
    const novels = [
      { old: 'Quy Xa', title: 'Quỷ Xá', author: 'Bạch Phù Lan', cat: 'Kinh Dị', views: 95000, rating: 4.7, ago: 1, desc: 'Ngôi nhà hoang cuối xóm ẩn chứa bí mật kinh hoàng. Mỗi đêm rằm, tiếng khóc lại vang lên từ căn gác xếp phủ bụi.' },
      { old: 'Tu Chan Lieu Thien Quan', title: 'Tu Chân Liêu Thiên Quần', author: 'Trần Thanh', cat: 'Huyền Huyễn', views: 78000, rating: 4.6, ago: 0, desc: 'Tỉnh dậy, Lâm Phàm phát hiện mình lạc vào nhóm chat của các tu chân giả. Tưởng trò đùa, nào ngờ linh khí thật sự tràn vào cơ thể.' },
      { old: 'Vo Boss La Than Y', title: 'Vợ Boss Là Thần Y', author: 'Nguyệt Hạ', cat: 'Ngôn Tình', views: 88000, rating: 4.6, ago: 0, desc: 'Cô vợ bị cả nhà chồng coi thường hóa ra là thần y ẩn danh. Khi thân phận bại lộ, vị tổng tài lạnh lùng bắt đầu theo đuổi vợ mỗi ngày.' },
      { old: 'Kiem Dao Doc Ton', title: 'Kiếm Đạo Độc Tôn', author: 'Lăng Tiêu', cat: 'Tiên Hiệp', views: 72000, rating: 4.5, ago: 2, desc: 'Một kiếm phá vạn pháp! Thiếu niên phế vật nhặt được tàn kiếm thượng cổ, từ đó quật khởi, độc bộ thiên hạ.' },
      { old: 'Trong Sinh Do Thi Cuong Long', title: 'Trọng Sinh Đô Thị Cuồng Long', author: 'Trần Phong', cat: 'Đô Thị', views: 60000, rating: 4.3, ago: 10, desc: 'Long vương trọng sinh về thời niên thiếu, khi gia tộc còn chưa sụp đổ. Kiếp này, hắn thề bảo vệ người thân, tung hoành đô thị.' },
      { old: 'Toan Dan Linh Chu', title: 'Toàn Dân Linh Chủ', author: 'Mạc Vấn', cat: 'Huyền Huyễn', views: 52000, rating: 4.4, ago: 1, desc: 'Xuyên vào thế giới linh chủ, ai cũng có thể mở lãnh địa riêng. Tô Mục thức tỉnh thiên phú thần cấp, bắt đầu con đường tranh bá.' },
      { old: 'Duy nhat la em', title: 'Duy Nhất Là Em', author: 'An Nhiên', cat: 'Ngôn Tình', views: 55000, rating: 4.4, ago: 3, desc: 'Giữa biển người mênh mông, anh chỉ nhận ra một mình em. Chuyện tình nhẹ nhàng, chữa lành những trái tim từng tổn thương.' },
      { old: 'Dac Cong Vuon Truong', title: 'Đặc Công Vườn Trường', author: 'Hàn Chung', cat: 'Hành Động', views: 45000, rating: 4.0, ago: 8, desc: 'Nữ đặc công cải trang thành học sinh trà trộn vào vườn trường để bảo vệ nhân chứng. Sóng gió học đường xen lẫn nhiệm vụ sinh tử.' },
      { old: 'Co Vo Ngot Ngao Cua Tong Tai', title: 'Cô Vợ Ngọt Ngào Của Tổng Tài', author: 'Hạ An', cat: 'Ngôn Tình', views: 40000, rating: 4.0, ago: 20, desc: 'Hợp đồng hôn nhân một năm, ai ngờ tổng tài mặt lạnh lại thật lòng. Mỗi ngày đều là màn rải đường ngọt đến sâu răng.' },
      { old: 'Truong Sinh Mot Doi Binh Pham', title: 'Trường Sinh Một Đời Bình Phàm', author: 'Hoàng Huy', cat: 'Tiên Hiệp', views: 30000, rating: 4.1, ago: 15, desc: 'Không tranh bá, không nghịch thiên, chỉ cầu một đời bình phàm mà trường sinh. Nhìn vương triều thay đổi, lòng vẫn như giếng cổ.' },
      { old: 'Am Duong Quan Tro', title: 'Âm Dương Quán Trọ', author: 'Dạ Quỷ', cat: 'Kinh Dị', views: 25000, rating: 4.2, ago: 5, desc: 'Quán trọ chỉ mở cửa lúc nửa đêm, khách đến đều không phải người sống. Chủ quán trẻ tuổi giữ cuốn sổ sinh tử của cả con phố.' },
      { old: 'Hoc Ba Xuyen Thanh Phao Hoi', title: 'Học Bá Xuyên Thành Pháo Hôi', author: 'Tố Lê', cat: 'Hiện Thực', views: 18000, rating: 4.1, ago: 0, desc: 'Học bá tỉnh dậy thấy mình xuyên sách thành nữ phụ pháo hôi. Không cam chịu số phận, cô dùng tri thức thay đổi kết cục của chính mình.' },
    ];
    const chapNames = ['Khởi Đầu', 'Gặp Gỡ', 'Biến Cố', 'Cao Trào', 'Bí Mật (VIP)', 'Lật Kèo (VIP)'];

    for (let k = 0; k < novels.length; k++) {
      const n = novels[k];
      // Gom mọi dòng trùng tên cũ/mới về 1 (giữ id nhỏ nhất) để không kẹt UNIQUE(title)
      const dupes = await pool.query(
        'SELECT id FROM novels WHERE title=$1 OR title=$2 ORDER BY id', [n.title, n.old]);
      let novelId;
      const catId = catMap[n.cat] || null;
      if (dupes.rows.length > 0) {
        novelId = dupes.rows[0].id;
        for (const d of dupes.rows.slice(1)) {
          await pool.query('DELETE FROM novels WHERE id=$1', [d.id]); // CASCADE dọn chương/con
        }
        await pool.query(
          `UPDATE novels SET title=$1, author=$2, description=$3, category_id=$4,
           total_views=$5, rating=$6, power_votes=$7 WHERE id=$8`,
          [n.title, n.author, n.desc, catId, n.views, n.rating,
           Math.floor(n.views / 500), novelId]);
      } else {
        const cover = 'https://picsum.photos/seed/novel' + (k + 1) + '/300/400';
        const res = await pool.query(
          `INSERT INTO novels(title, author, description, cover_url, category_id,
           total_views, rating, power_votes, status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [n.title, n.author, n.desc, cover, catId, n.views, n.rating,
           Math.floor(n.views / 500), 'ongoing']);
        novelId = res.rows[0].id;
      }
      // Chương: UPDATE tại chỗ theo (novel_id, chapter_number) -> không trùng, đủ dấu.
      // Nội dung demo do nhóm tự viết (không copy web khác để tránh bản quyền).
      const chapOpen = [
        'Mưa lất phất rơi, nhân vật chính đẩy cánh cửa gỗ cũ kỹ và bước vào một không gian hoàn toàn xa lạ.',
        'Không ai ngờ buổi sáng bình thường ấy lại là khởi đầu của chuỗi biến cố không thể quay đầu.',
        'Tin tức lan ra như lửa gặp gió. Kẻ vui mừng, người lo sợ, còn nhân vật chính chỉ im lặng siết chặt tay.',
        'Đêm xuống, ánh đèn dầu chập chờn soi rõ gương mặt đầy quyết tâm chưa từng thấy trước đây.',
        'Bí mật bị chôn giấu nhiều năm cuối cùng cũng lộ ra, kéo theo những cái giá không ai lường trước.',
        'Khi mọi thứ tưởng như sụp đổ, một bàn tay bất ngờ chìa ra từ trong bóng tối.',
      ];
      for (let i = 1; i <= 6; i++) {
        const locked = i >= 5;
        const chapTitle = 'Chương ' + i + ': ' + chapNames[i - 1];
        const chapBody =
          n.desc + '\n\n' +
          chapOpen[i - 1] + ' ' + chapNames[i - 1] + ' lần này không giống bất kỳ lần nào trước đó.\n\n' +
          'Nhân vật chính đứng trước lựa chọn khó khăn: tiến lên thì hiểm nguy rình rập, lùi lại thì đánh mất tất cả. ' +
          'Từng câu chữ, từng ánh mắt của người đối diện đều như đang thử thách lòng kiên định.\n\n' +
          'Cao trào dâng lên khi sự thật từng phần hé lộ. Độc giả đừng bỏ lỡ diễn biến tiếp theo của "' +
          n.title + '" (' + n.author + '). Hãy bình luận cảm nghĩ và đề cử để ủng hộ tác giả nhé!';
        await pool.query(
          `INSERT INTO chapters(novel_id, chapter_number, title, content, is_locked, price_coins)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (novel_id, chapter_number)
           DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content,
             is_locked=EXCLUDED.is_locked, price_coins=EXCLUDED.price_coins`,
          [novelId, i, chapTitle, chapBody, locked, locked ? 20 : 0]);
      }
      await pool.query(
        "UPDATE novels SET updated_at = NOW() - ($1 || ' days')::interval WHERE id=$2",
        [String(n.ago), novelId]);
    }
    console.log('Seed done (12 truyen tieng Viet, khong trung)');
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
seed();
