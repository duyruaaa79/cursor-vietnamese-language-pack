# Vietnamese Language Pack for Cursor

Gói ngôn ngữ **Tiếng Việt** cho [Cursor](https://cursor.com). Extension này Việt hóa:

- giao diện lõi (menu, Explorer, Settings, Git, Command Palette) qua catalog NLS của ứng dụng;
- giao diện riêng của Cursor không đi qua NLS (Cursor Settings, Agents Window, chat, Automations, thanh toán, thông báo) bằng cách vá chuỗi hiển thị trong các bundle `workbench.*.js` — **chỉ trên Windows/Linux**.

Sau mỗi lần Cursor cập nhật, extension tự Việt hóa lại khi Cursor khởi động và nhắc bạn mở lại Cursor một lần.

> **macOS:** macOS kiểm tra chữ ký số của toàn bộ `Cursor.app` (kể cả file JS) và giết tiến trình ngay khi mở nếu có file bị sửa (`amfid`: “The signature on the file is invalid”). Vì vậy trên macOS extension **không bao giờ sửa `Cursor.app`**; nếu phát hiện file đã bị bản cũ vá, extension tự khôi phục bản gốc. Nếu Cursor không mở được, chạy `~/.cursor-vietnamese/Khoi-phuc-Cursor.command`.
>
> Thay vào đó, giao diện riêng của Cursor được Việt hóa **lúc chạy**, không sửa `Cursor.app` và không khởi động lại: extension cài tác vụ nền `~/Library/LaunchAgents/vn.duy.cursor-vietnamese.plist`. Mỗi khi Cursor mở (Cursor tạo thư mục mới trong `logs/`), tác vụ này gửi `SIGUSR1` để tiến trình chính của Cursor mở cổng gỡ lỗi Node trên `127.0.0.1:9229`, cài bộ dịch cho mọi cửa sổ (kể cả Agents Window và cửa sổ mở sau), rồi đóng cổng ngay (dưới một giây). Nội dung chat, mã nguồn và terminal không bị dịch. Tắt bằng `cursorVietnamese.runtimeTranslate`.

## Cài vào Cursor

1. Tạo file VSIX:

```bash
npm run package
```

2. Trong Cursor: `Cmd+Shift+P` → **Extensions: Install from VSIX...** → chọn file `.vsix`.
3. `Cmd+Shift+P` → **Configure Display Language** → chọn **Tiếng Việt** (`vi`).
4. Thoát hẳn Cursor (`Cmd+Q`) rồi mở lại.

## Cách tự Việt hóa sau khi cập nhật

Khi Cursor khởi động, extension:

1. tải bản dịch mới nhất `dist/dict.json` từ GitHub (tối đa một lần mỗi ngày);
2. dựng lại language pack theo đúng chuỗi tiếng Anh của bản Cursor đang chạy, rồi xóa cache NLS cũ;
3. vá chuỗi hiển thị trong bundle Cursor, sao lưu bản gốc vào `~/.cursor-vietnamese/backup/<commit>/` và cập nhật checksum trong `product.json` để Cursor không báo “cài đặt bị hỏng”;
4. nếu có thay đổi, hiện thông báo kèm nút **Thoát Cursor**.

Lệnh trong Command Palette:

- **Tiếng Việt: Việt hóa giao diện Cursor** — vá ngay
- **Tiếng Việt: Khôi phục giao diện gốc của Cursor** — trả file gốc và tắt tự vá
- **Tiếng Việt: Xem trạng thái Việt hóa**

Cài đặt: `cursorVietnamese.autoPatch`, `cursorVietnamese.autoUpdateDictionary` (mặc định bật).

Dòng lệnh: `node bin/cli.js <apply|restore|status|extract|sync-langpack>`. Trên macOS, `apply` từ chối vá trừ khi thêm `--force-unsafe` (chỉ dùng cho bản sao thử nghiệm).

## Giới hạn

- Chuỗi mới xuất hiện trong bản Cursor mới sẽ giữ tiếng Anh cho tới khi `dist/dict.json` trên GitHub được bổ sung.
- Chuỗi mà Cursor dùng để so sánh, `switch`, làm khóa tra cứu hoặc lưu trữ được giữ tiếng Anh để không làm hỏng logic. Riêng phép so sánh với `.label`/`.title` do chính Cursor gán thì được dịch đồng bộ cả hai phía.
- Prompt gửi cho mô hình AI, thông báo lỗi nội bộ và code của các extension tích hợp (`cursor-agent-*`, `cursor-mcp`, …) không bị sửa.
- Trước khi gỡ extension, chạy **Khôi phục giao diện gốc của Cursor**; nếu không, bundle đã vá vẫn giữ tiếng Việt cho tới lần Cursor cập nhật kế tiếp.
- Tên sản phẩm (Cursor, Agent, Composer, Git, MCP) giữ nguyên.

## Phát triển

- `i18n/vi.json` — bản dịch catalog NLS, ánh xạ nguyên văn tiếng Anh → tiếng Việt
- `i18n/cursor-ui.json` — bản dịch chuỗi giao diện riêng của Cursor
- `scripts/build.py` — đọc `/Applications/Cursor.app`, ghi `translations/`, `dist/dict.json` và `package.json`
- `scripts/validate_vi.py` — kiểm tra placeholder (`{0}`, `&&`, backtick, URL, thẻ HTML)
- `scripts/merge_translations.py [--target i18n/cursor-ui.json]` — gộp bản dịch mới
- `src/` — code extension: vá bundle, đồng bộ language pack, tải từ điển
- `node bin/cli.js extract` — liệt kê chuỗi giao diện Cursor để dịch thêm

## Giấy phép

MIT
