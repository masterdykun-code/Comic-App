# Khảo sát API truyện tranh cho WebNovel

Ngày kiểm tra: **20/10/2026**. Phạm vi: MangaDex và **hai nguồn khác**, MangaBaka, Pepper&Carrot. OTruyen tiếp tục tạm dừng.

## 1. Kết quả chính

| Nguồn | JSON dữ liệu thực tế | Chương tiếng Việt | Trang ảnh trong chương | Mức phù hợp |
| --- | --- | --- | --- | --- |
| MangaDex | HTTP 200: danh sách, chi tiết truyện, feed, chi tiết chương | Đã thấy `translatedLanguage: "vi"` | Metadata hai chương ghi 41 và 30 trang; **chưa gọi endpoint lấy danh sách ảnh** vì robots chặn `/at-home/` | Tiềm năng lớn cho nhiều đầu truyện, cần giải quyết truy cập ảnh, quyền sử dụng và proxy trước |
| Pepper&Carrot | HTTP 200: JSON danh mục tập | 38/39 mục trong JSON đánh dấu có `vi` | Một tập mẫu có danh sách file thực tế P00–P08; có bìa riêng; một trang là GIF | Phù hợp nhất cho nội dung Việt nhiều trang có giấy phép rõ; chỉ là một bộ truyện |
| MangaBaka | HTTP 200: tìm kiếm và chi tiết | Chưa xác minh chương Việt; ngôn ngữ tiêu đề không phải ngôn ngữ chương | Không tìm thấy chức năng cung cấp nội dung chương hoặc danh sách trang trong phạm vi tài liệu đã đọc | Dùng bổ sung metadata; không giải quyết nhu cầu đọc COMIC |

**Hai đề xuất:** (1) Pepper&Carrot cho thử nghiệm nội dung nhiều trang có quyền tái sử dụng; (2) MangaDex cho bước đánh giá kỹ thuật có điều kiện. Chưa đề xuất đưa MangaDex vào sử dụng chính thức hoặc sao chép ảnh sang Cloudinary. Không đề xuất MangaBaka làm nguồn đọc truyện.

Một lần HTTP 200 chỉ chứng minh khả năng truy cập tại thời điểm đo, không chứng minh SLA hay ổn định dài hạn. Không có nguồn nào được tuyên bố đã kiểm thử đọc ảnh trên Android trong đợt này.

## 2. Phương pháp và bằng chứng

- Chỉ GET, không đăng nhập, không gửi JWT WebNovel, không gọi Cloudinary, không tải file ảnh.
- Các probe lưu cách nhau khoảng 1,5–2 giây; không gặp 429 và không thử vượt hạn chế.
- Có **20 probe trực tiếp được lưu** tại `backend/docs/research/comic-api-2026-10-20/`; gồm 7 phản hồi dữ liệu JSON thành công, 1 phản hồi JSON 400 kiểm tra hợp đồng tìm kiếm, cùng tài liệu/robots/index thư mục. Ngoài ra đầu phiên có ba kiểm tra GET kết nối/robots MangaDex; `/ping` trả `200 pong`, không được tính là JSON danh mục.
- Công cụ tìm kiếm được dùng để đọc tài liệu chính thức. Không dùng blog bên thứ ba làm bằng chứng endpoint hoặc giấy phép.
- `request-index.json` tổng hợp URL, thời điểm, HTTP status và loại phản hồi. Các file bằng chứng giữ phản hồi để đối chiếu; header cookie không được lưu.
- Không mở kết nối PostgreSQL trong đợt nghiên cứu này. Không cần đọc lại tài khoản hoặc dữ liệu thật để so sánh cấu trúc.

## 3. MangaDex

### Endpoint thực tế

Base URL đã xác minh: `https://api.mangadex.org`.

| GET path/query đã gọi | HTTP | Kết quả |
| --- | --- | --- |
| `/manga?limit=1&availableTranslatedLanguage[]=vi&contentRating[]=safe` | 200 JSON | Một truyện; `total: 4571` tại thời điểm đo, là tổng metadata khớp bộ lọc, không phải số truyện đã kiểm tra ảnh |
| `/manga/1ee97895-4796-4bcf-bcd1-5ef99c011f8b?includes[]=author&includes[]=cover_art` | 200 JSON | Chi tiết **Yuru Camp△ / Dã Ngoại Thảnh Thơi**, quan hệ tác giả và bìa |
| `/manga/1ee97895-4796-4bcf-bcd1-5ef99c011f8b/feed?limit=2&translatedLanguage[]=vi&contentRating[]=safe&order[chapter]=asc` | 200 JSON | Hai chương tiếng Việt; trang theo metadata: 41, 30 |
| `/chapter/3d34b09e-b103-4eeb-b87f-74dce463375d` | 200 JSON | Chi tiết chương 1, không chứa mảng tên file ảnh |
| `/docs/static/api.yaml` | 200 YAML | OpenAPI phiên bản **5.13.1**, không phải JSON dữ liệu truyện |
| `/robots.txt` | 200 text | `User-agent: *` và `Disallow: /at-home/` |

Mẫu JSON lược bỏ, lấy từ phản hồi thật:

```json
{
  "result": "ok",
  "response": "collection",
  "data": [
    {
      "id": "3d34b09e-b103-4eeb-b87f-74dce463375d",
      "type": "chapter",
      "attributes": {
        "volume": "1",
        "chapter": "1",
        "translatedLanguage": "vi",
        "externalUrl": null,
        "isUnavailable": false,
        "pages": 41
      }
    },
    {
      "id": "8fc04a69-4bdc-44af-8858-88bb7bb5d175",
      "type": "chapter",
      "attributes": {
        "chapter": "2",
        "translatedLanguage": "vi",
        "pages": 30
      }
    }
  ]
}
```

### Danh sách ảnh: hợp đồng có tài liệu, chưa xác minh trực tiếp

OpenAPI công bố `GET /at-home/server/{chapterId}` trả `baseUrl`, `chapter.hash`, `chapter.data[]`, `chapter.dataSaver[]`. Theo hợp đồng:

```text
Ảnh gốc:    {baseUrl}/data/{hash}/{filename trong data[]}
Ảnh nhẹ:    {baseUrl}/data-saver/{hash}/{filename trong dataSaver[]}
Thứ tự:     giữ nguyên vị trí trong mảng, không sắp xếp tên file
```

**Không có HTTP status hoặc JSON thực nghiệm cho endpoint này trong báo cáo.** Không gọi vì robots tại hostname API cấm đường dẫn đó. API công bố khả năng đọc cho ứng dụng, nhưng khảo sát tự động phải tôn trọng hạn chế; cần xác nhận cách truy cập được nhà cung cấp cho phép trước bước kiểm thử ảnh. Không dựng URL giả để thay cho phản hồi chưa lấy được.

Tài liệu ghi `baseUrl` cấp cho một chương, có hiệu lực **15 phút**. Vì vậy không lưu URL cấp tạm làm `ChapterPage.imageUrl` vĩnh viễn. Bìa nằm trong quan hệ `cover_art` với `fileName`; ảnh bìa thực tế chưa được tải hoặc kiểm tra hiển thị.

### Authentication, giới hạn và điều kiện sử dụng

- Bốn GET dữ liệu trên thành công **không có Authorization/API key**. Không suy rộng thành mọi chức năng đều không cần tài khoản hoặc không có giới hạn Guest.
- Tài liệu yêu cầu HTTPS, User-Agent trung thực, không có header `Via`; không cấp CORS cho website bên ngoài và yêu cầu proxy request/ảnh, có chống hotlink. Mobile Native không chịu CORS như trình duyệt nhưng vẫn chịu quy tắc ảnh và chính sách dịch vụ.
- Tài liệu hiện tải được ghi khoảng **5 request/giây/IP**, AtHome **40/phút**; collection bị giới hạn `offset + size <= 10000`. Phải theo quota/header thực tế, dừng/backoff khi 429; không coi các con số này là toàn bộ cơ chế chống lạm dụng.
- AUP yêu cầu ghi công MangaDex và nhóm dịch, tôn trọng yêu cầu gỡ của nhóm, không chạy quảng cáo hoặc dịch vụ trả phí. AUP truy cập API **không phải bằng chứng cấp quyền phân phối mọi tác phẩm/bản dịch/ảnh**. Mẫu Yuru Camp chỉ dùng kiểm tra JSON, không được phê duyệt để import hay rehost.

Nguồn chính thức: [API docs và AUP](https://api.mangadex.org/docs/), [giới hạn và yêu cầu kết nối](https://api.mangadex.org/docs/2-limitations/), [OpenAPI](https://api.mangadex.org/docs/static/api.yaml), [robots](https://api.mangadex.org/robots.txt). Bản tải thực tế nằm trong các file `md-*.json`.

## 4. Pepper&Carrot — API tĩnh được tác giả công bố

Đây là **một bộ webcomic nhiều tập**, không phải API danh mục nhiều tác phẩm. Không cần dùng Framagit API: website chính thức đã có JSON phục vụ ứng dụng.

| GET đã gọi | HTTP | Kết quả |
| --- | --- | --- |
| `https://peppercarrot.com/0_sources/episodes.json` | 200 JSON | 39 tập, 38 tập có `vi`; không có phân trang |
| `https://peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/` | 200 HTML index | Danh sách file thực tế cho nhiều ngôn ngữ, đã lọc tên file `vi_` cục bộ; không tải ảnh |
| `https://www.peppercarrot.com/en/documentation/130_API.html` | 200 HTML | Tài liệu JSON index, cấu trúc thư mục và tên file |
| `https://peppercarrot.com/robots.txt` | 200 text | Không chặn hai đường dẫn nguồn đã kiểm tra |

Mục JSON thật, chỉ giữ trường cần thiết:

```json
{
  "name": "ep04_Stroke-of-genius",
  "total_pages": 8,
  "translated_languages": ["vi"]
}
```

`translated_languages` trên đã **rút gọn**, phản hồi thật còn các ngôn ngữ khác. Mẫu bìa và trang được thấy trong index:

```text
Bìa:  https://peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/vi_Pepper-and-Carrot_by-David-Revoy_E04.jpg
P01:  https://peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/vi_Pepper-and-Carrot_by-David-Revoy_E04P01.jpg
P05:  https://peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/vi_Pepper-and-Carrot_by-David-Revoy_E04P05.gif
P08:  https://peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/vi_Pepper-and-Carrot_by-David-Revoy_E04P08.jpg
```

- Index thư mục có **9 file trang P00–P08**, cộng một file bìa; tài liệu nói `total_pages` không tính trang ghi công. Cần quy ước giữ trang ghi công và đánh số nội bộ từ 1; không tự bỏ trang, không tính bìa thành trang đọc. Chưa xem ảnh để phân loại vị trí trang ghi công bằng hình ảnh.
- Không thể giả định mọi trang là `.jpg`: **P05 là GIF**. Bộ upload WebNovel hiện chỉ chấp nhận JPEG/PNG/WebP; nếu sau này nhập qua đường này, cần xử lý định dạng được duyệt, kiểm tra ảnh động và giữ thông tin biến đổi. Chưa chuyển đổi hoặc upload gì.
- JSON index cung cấp danh sách tập/ngôn ngữ/số trang; không có endpoint chi tiết truyện, tìm kiếm, phân trang kiểu manga platform. Chi tiết/ghi công nằm ở website và các `info.json` được tài liệu mô tả, không được giả thành dữ liệu đã lấy từ endpoint chi tiết REST.
- Không cần auth cho index và danh sách file đã gọi. Chưa thấy quota số cụ thể trong tài liệu API; điều đó không có nghĩa được tải không giới hạn. Nếu triển khai, cache index, hạn chế concurrency, tôn trọng 429/Retry-After và tránh đọc lại toàn bộ thư mục thường xuyên.
- Website công bố webcomic, bản dịch và artwork theo **CC BY 4.0 trừ ngoại lệ**. Phải giữ tác giả David Revoy, nguồn, link giấy phép, ghi công bản dịch từng tập và nêu thay đổi. Không lấy fan-art hoặc nội dung khác rồi mặc định cùng giấy phép.

Nguồn chính thức: [API](https://www.peppercarrot.com/en/documentation/130_API.html), [JSON và ghi công bản dịch](https://www.peppercarrot.com/en/documentation/080_JSON_files.html), [giấy phép](https://www.peppercarrot.com/en/about/index.html), [JSON trực tiếp](https://peppercarrot.com/0_sources/episodes.json).

**Tương thích thư viện hiện có:** manifest `sample-library-v1` đã có `sample-v1-pepper-carrot`, ba tập đầu. Không tạo một Story Pepper&Carrot thứ hai hoặc nhập lại các tập đó. Tập 4 ở đây chỉ là mẫu đọc metadata/file index; chưa duyệt mở rộng dữ liệu Story hiện có.

## 5. MangaBaka — metadata, không phải nguồn trang đọc

Base URL đã xác minh: `https://api.mangabaka.org`.

| GET path/query đã gọi | HTTP | Kết quả |
| --- | --- | --- |
| `/v1/series/1` | 200 JSON | Chi tiết **DICE**, ID số nguyên, metadata và bìa |
| `/v1/series/search` | 400 JSON | `Please provide at least one query argument`; lỗi đầu vào, không phải mất kết nối |
| `/v1/series/search?q=DICE` | 200 JSON | `pagination`: count 82, page 1, limit 10, next; đã đọc mẫu DICE |
| `/robots.txt` | 200 text | Cho phép `/v0/`, `/v1/`, `/v2/`, chặn đường dẫn `/my/` tương ứng |

Mẫu JSON thật rút gọn:

```json
{
  "status": 200,
  "pagination": {"count": 82, "page": 1, "limit": 10},
  "data": [{"id": 1, "title": "DICE", "type": "manhwa"}]
}
```

Chi tiết có `cover`, `authors`, `artists`, `titles`, `genres`, `total_chapters`, liên kết nhà cung cấp. `total_chapters` là **metadata số lượng**, không phải mảng chương chứa ảnh. Không có bằng chứng API này cung cấp bản dịch Việt để đọc; `titles` theo ngôn ngữ không chứng minh có trang dịch tương ứng. Không gọi các route `/chapter` hoặc `/pages` tự đoán.

Các GET mẫu không cần auth. Tài liệu ghi search 30/phút/IP, default 180/phút/IP cho request không cache, chia sẻ quota theo loại; phản hồi 429 khi vượt. Dữ liệu gốc MangaBaka chịu CC BY-NC-SA 4.0, dữ liệu bên thứ ba giữ điều kiện riêng; cần ghi công cả nguồn gốc. AUP cấm biến dịch vụ thành mirror/kho dữ liệu hàng loạt hoặc dịch vụ cạnh tranh. Không suy ra quyền sao chép ảnh bìa chỉ từ việc URL bìa xuất hiện trong JSON. Schema API còn có thể thay đổi; các trường metadata cũ/v2 cần đối chiếu Explorer khi lập trình.

Nguồn chính thức: [API và quota](https://mangabaka.org/data/api), [Explorer](https://mangabaka.org/data/api/explorer), [AUP](https://mangabaka.org/about/acceptable-use), [điều kiện phi thương mại](https://mangabaka.org/about/data-license-noncommercial). Không khuyến nghị nguồn này để thay thế OTruyen cho COMIC Reader.

## 6. Mapping và mức sửa đổi WebNovel nếu được duyệt sau này

Đã đọc lại `backend/prisma/schema.prisma`, `src/services/chapter.service.ts`, `src/middlewares/chapter.validation.ts` và Mobile `src/features/reader/api.ts`, `ComicContent.tsx`.

| Đặc điểm | WebNovel hiện tại | MangaDex | Pepper&Carrot | MangaBaka |
| --- | --- | --- | --- | --- |
| Story ID | UUID nội bộ, slug unique | UUID nguồn, vẫn cần phân biệt namespace/định danh nguồn | Một bộ, tập có tên thư mục ổn định | ID số, cần mapping |
| Chapter | Số nguyên dương unique trong Story | `chapter` là chuỗi; có thể thập phân/null và nhiều nhóm dịch cùng chương; cần giữ số nguồn riêng, không ép làm tròn | Số tập ánh xạ rõ | Không có nội dung chương trong mẫu |
| ChapterPage | Nhiều dòng, pageNumber dương unique | Chỉ ánh xạ sau khi lấy được danh sách ảnh hợp lệ; URL cấp tạm không lưu vĩnh viễn | Sắp theo số Pxx, giữ đuôi file thực tế, ánh xạ số nội bộ | Không cung cấp |
| Dữ liệu nguồn | Chưa có registry provider/external ID | Cần định danh manga/chapter/group/language và lifecycle ảnh | Có thể tiếp tục manifest nguồn, tránh trùng tập đã có | Metadata tham khảo |
| `storagePublicId` | Nullable | Để null nếu không có tài nguyên Cloudinary thuộc dự án | Tương tự, không dùng tên file nguồn như Cloudinary publicId | Tương tự với bìa |

Backend hiện trả **toàn bộ** trang chương theo `pageNumber`, không giới hạn một ảnh. API lưu trang và parser Mobile giới hạn 200 trang/chương; mẫu 41/30 và tập Pepper nằm trong mức này. `FlatList.initialNumToRender=2` là tối ưu render, không cắt nội dung còn hai ảnh. Chưa kiểm thử Native với các nguồn mới.

Những điểm cần thiết kế trước triển khai:

1. **Metadata/live adapter:** cần module provider ở Backend, timeout, cache, backoff, validate response, lọc nội dung, giữ attribution; Mobile có adapter DTO nguồn ngoài. Với MangaDex phải giải quyết proxy ảnh theo chính sách và SSRF allowlist/redirect validation; không làm open proxy và không chuyển JWT nội bộ lên nguồn.
2. **Tính năng cá nhân:** Favorites/Comments/Ratings dùng FK Story thật, Progress/History dùng FK Chapter thật và đúng Story. Không nhét ID nguồn hoặc UUID giả vào API hiện tại. Reader chỉ đọc ngoài có thể không cần migration nhưng phải tách đường ghi lịch sử/tiến độ; không tái sử dụng nguyên luồng sync hiện có.
3. **Lưu PostgreSQL đầy đủ:** nội dung được phép có thể ánh xạ vào các bảng hiện có, nhưng định danh nguồn, số chương đặc biệt, ngôn ngữ/nhóm dịch và chống trùng bền vững cần registry/thiết kế được duyệt. Chưa đề xuất sửa migration cụ thể và chưa thay schema.
4. **Tương thích:** giữ nguyên 25 tác phẩm đã nhập và mọi dữ liệu khác đang tồn tại; nguồn ngoài phải có namespace và chiến lược dedup, không ghi đè slug, chương hoặc page. Mất kết nối nguồn không ảnh hưởng việc đọc thư viện nội bộ.

Luồng dự kiến, chưa triển khai:

```text
Mobile → WebNovel provider adapter → API nguồn (GET, cache/quota)
       ← DTO có nguồn, ngôn ngữ, chương, thứ tự trang
Ảnh    → tuyến được nhà cung cấp cho phép / proxy an toàn nếu bắt buộc

Thư viện PostgreSQL hiện có → API nội bộ → Reader hiện có (giữ nguyên)
```

## 7. Khuyến nghị và điều kiện duyệt

**Ưu tiên 1 — Pepper&Carrot:** bằng chứng JSON, Việt ngữ, nhiều trang và giấy phép rõ nhất trong ba nguồn. Giới hạn là chỉ mở rộng một bộ đã có, không tạo thư viện nhiều đầu truyện Việt. Nếu duyệt, lập danh sách tập chưa nhập, kiểm tra ảnh/credits và trường hợp GIF; chưa import hoặc sửa Story hiện có.

**Ưu tiên 2 — MangaDex, có điều kiện:** thích hợp nhất về danh mục đa tác phẩm và bộ lọc `vi`; đã xác minh dữ liệu chương nhiều trang. Trước triển khai phải làm rõ cách kiểm thử hợp lệ endpoint ảnh bị robots chặn, xác nhận giới hạn Guest/auth hiện hành, kiểm thử URL hết hạn/proxy và quyền từng nội dung. Chưa thể coi đây là nguồn ảnh đã được xác minh đầy đủ hoặc nguồn cho phép import hàng loạt.

Không có bằng chứng đủ để hứa một nguồn nhiều đầu truyện Việt, có quyền phân phối rõ và đã chạy trọn luồng ảnh trong phạm vi kiểm tra nhỏ này. Có thể duyệt bước thử nghiệm tiếp theo cho một trong hai nguồn trên; không cần chọn MangaBaka cho chức năng đọc.

## 8. Trạng thái kết thúc

- Chỉ thêm báo cáo này và các file bằng chứng nghiên cứu; không sửa mã ứng dụng/config/schema/migration.
- Không truy cập ghi, import, seed hoặc publish trong hai Database; không gọi Cloudinary, không tải hàng loạt ảnh, không thay đổi tài khoản.
- Không chạy test/build ứng dụng vì không có thay đổi mã nguồn. JSON và các số đếm trong bằng chứng được kiểm tra cục bộ.
- Dừng tại nghiên cứu, chờ người dùng duyệt phương án.
