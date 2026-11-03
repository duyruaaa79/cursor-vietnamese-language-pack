# Vietnamese Language Pack for Cursor

Gói ngôn ngữ **Tiếng Việt** cho [Cursor](https://cursor.com). Extension này Việt hóa giao diện lõi (menu, Explorer, Settings, Git, Command Palette) và các chuỗi Cursor đi qua catalog NLS của ứng dụng (Agent, Composer, Plan, …).

Microsoft chưa phát hành Language Pack tiếng Việt chính thức. Gói này được tạo từ catalog NLS của Cursor đã cài trên máy, rồi dịch sang tiếng Việt.

## Cài vào Cursor

1. Tạo file VSIX:

```bash
npm install -g @vscode/vsce
python3 scripts/build.py
vsce package --allow-missing-repository
```

2. Trong Cursor: `Cmd+Shift+P` → **Extensions: Install from VSIX...** → chọn file `.vsix`.
3. `Cmd+Shift+P` → **Configure Display Language** → chọn **Tiếng Việt** (`vi`).
4. Khởi động lại Cursor.

## Phạm vi

| Được Việt hóa | Có thể vẫn tiếng Anh |
| --- | --- |
| Menu, Explorer, Search, SCM, Debug, Extensions | Màn hình Cursor Settings nếu không đi qua NLS |
| Settings lõi, Command Palette (một phần) | Chat/Agent render bằng React ngoài NLS |
| Chuỗi Cursor có trong `nls.messages.json` | Tên sản phẩm: Cursor, Agent, Composer, Git |

Cập nhật Cursor có thể thêm chuỗi mới. Chạy lại `python3 scripts/build.py` rồi đóng gói VSIX.

## Phát triển

- `scripts/translate_vi.py` — từ điển và quy tắc dịch
- `scripts/build.py` — đọc `/Applications/Cursor.app` và ghi `translations/`

## Giấy phép

MIT
