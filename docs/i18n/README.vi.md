# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Trang này hướng dẫn những thao tác thường dùng và các giới hạn cần lưu ý. Trường hợp nâng cao được giải thích trong bản [tiếng Anh](../../README.md) và [tiếng Trung giản thể](README.zh-CN.md).

Thêm ô gộp, nhiều hàng tiêu đề cột, tiêu đề hàng và bảng không có tiêu đề cột vào bảng Markdown. Chỉ xem bảng sẽ không viết lại nội dung Markdown của ghi chú.

## Ảnh chụp màn hình

### Bảng ba đường kẻ trong chế độ đọc

Hiển thị nhóm tiêu đề và các ô đã gộp mà không vẽ khung cho mọi ô.

![Bảng ba đường kẻ với các ô gộp trong chế độ đọc](../assets/structural-tables-reading-view-en.png)

### Chỉnh sửa trong bản xem trước

Nhấp vào ô trên máy tính hoặc chạm hai lần trên màn hình cảm ứng để chỉnh sửa trực tiếp.

![Chỉnh sửa ô trong bản xem trước trực tiếp](../assets/structural-tables-live-preview-en.png)

### Cài đặt giao diện

![Cài đặt giao diện của Structural Tables](../assets/structural-tables-settings-en.png)

Ảnh cài đặt giao diện hiển thị các thành phần cài đặt và bảng thực tế trong trình duyệt thử nghiệm, không phải ảnh chụp ứng dụng Obsidian.

<!-- section: features -->
## Tính năng

- Xem trước và chuyển bảng Markdown, HTML theo cả hai chiều; thông báo nếu có nội dung hoặc kiểu dáng không thể giữ nguyên.

- Nhập `<` để gộp với cột trước đó theo thứ tự nguồn hoặc `^` để gộp với ô phía trên.
- Dùng hai dấu `||` liền nhau trong hàng phân cách để đánh dấu các cột làm tiêu đề hàng.
- Hiển thị cấu trúc gộp ô trong chế độ đọc và xem trước trực tiếp.
- Thêm, di chuyển, xóa hàng/cột hoặc hoán đổi hàng và cột của toàn bộ bảng.
- Sao chép dưới dạng HTML, GFM thông thường, TSV hoặc CSV; xuất PNG trên máy tính.
- Dán các bảng HTML được hỗ trợ từ trình duyệt và phần mềm bảng tính.
- Chuyển bảng thành Obsidian Base sau khi xem trước các bản ghi sẽ được tạo.
- Từ chối thao tác có thể làm mất dữ liệu ngoài vùng chọn, trừ khi người dùng chọn xóa một cách rõ ràng.

<!-- section: requirements-and-compatibility -->
## Yêu cầu và khả năng tương thích

Cần Obsidian 1.12.7 trở lên. Hỗ trợ máy tính và Android. Muốn chuyển bảng thành Base, hãy bật plugin lõi Bases của Obsidian.

`<`, `^` và `||` là cú pháp mở rộng nên các trình chỉnh sửa Markdown khác có thể hiển thị bảng gộp khác đi. Khi dùng Advanced Tables, chọn “Sửa mã Markdown của bảng” rồi kiểm tra lại dữ liệu sau khi sắp xếp bằng công cụ khác.

### Lưu ý và lời xin lỗi về khả năng tương thích của bảng

*2026-10-31*

Cũng như [Number Suite](https://github.com/ZHYX91/obsidian-number-suite), Structural Tables ban đầu chỉ là công cụ nhỏ tôi làm cho nhu cầu riêng khi đọc và xử lý bài báo khoa học trong Obsidian. Tôi chỉ dùng một phần ít tính năng của LaTeX nên nghĩ rằng mở rộng Markdown một chút là đủ. Lúc đầu tôi tập trung vào cách dùng của mình mà chưa cân nhắc đầy đủ nhu cầu của người khác hay khả năng mở ghi chú trong các trình soạn thảo Markdown khác.

Cú pháp cũ cho bảng không có tiêu đề cột và cho tiêu đề hàng không tuân theo cấu trúc bảng GFM. Vì thế, một số trình soạn thảo không nhận diện hoặc hiển thị bảng đúng cách. Đây là thiếu sót của tôi khi thiết kế. Tôi xin lỗi vì sự bất tiện khi đọc, chia sẻ hoặc chuyển ghi chú.

Để cải thiện, plugin đã thêm khả năng chuyển bảng giữa Markdown và HTML theo cả hai chiều. Bảng Markdown mở rộng có thể chuyển thành HTML mà giữ tiêu đề phức tạp và ô gộp; bảng HTML được hỗ trợ có thể chuyển lại thành Markdown. Khi GFM thông thường đủ biểu đạt, plugin sẽ dùng GFM; chỉ dùng cú pháp mở rộng cũ khi cần. Bạn có thể xem trước mã nguồn và những khác biệt về nội dung hay định dạng trước khi thay thế.

<!-- section: installation -->
## Cài đặt

Trong Obsidian, mở “Cài đặt → Plugin cộng đồng → Duyệt”, tìm Structural Tables, cài đặt và kích hoạt.

Để cài thủ công, giải nén `structural-tables-<version>.zip` vào `Vault/.obsidian/plugins/`, tải lại Obsidian rồi bật plugin.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Cách sử dụng

Đặt con trỏ trên một dòng trống, không chọn văn bản, rồi chạy **Chèn bảng có cấu trúc** trong bảng lệnh. Lệnh chèn ngay một bảng mẫu. Di chuyển con trỏ ra ngoài bảng trong chế độ xem trước trực tiếp hoặc chuyển sang chế độ đọc để xem kết quả. Bạn có thể sửa nội dung ví dụ cùng cấu trúc dưới đây:

```markdown
| Khu vực | Doanh số | < |
| Quý | Q1 | Q2 |
| --- || --- | --- |
| Miền Bắc | 10 | 12 |
| ^ | 8 | 11 |
```

`<` gộp với cột phía trước theo thứ tự nguồn, `^` gộp với ô ở trên. Ký hiệu `||` trong hàng phân cách đánh dấu ranh giới tiêu đề hàng và không tạo thêm cột.

Nếu bảng hiển thị không đúng, hãy chạy lệnh **Kiểm tra bảng có cấu trúc trong ghi chú hiện tại**. Lệnh chỉ báo lỗi cú pháp, không sửa Markdown.

Nhấp vào ô trong bản xem trước để sửa. Enter lưu và chuyển ô, Shift+Enter xuống dòng, Escape hủy. Kéo tay nắm hàng hoặc cột để di chuyển.

Khi chọn một vùng ô, Delete/Backspace chỉ xóa nội dung, không xóa hàng, cột hay cấu trúc gộp. Dùng menu chuột phải để xóa hàng, cột hoặc bảng; có thể hoàn tác bằng Undo.

Có thể sao chép, cắt và dán vùng ô khi bố cục gộp vẫn được giữ nguyên. Trên điện thoại, việc khởi động lại hoặc thay đổi bộ nhớ tạm sẽ làm mất thông tin gộp của lần sao chép trước.

Trên máy tính có thể xem trước, sao chép hoặc lưu PNG của toàn bộ bảng. Các thay đổi ô chưa lưu không nằm trong ảnh. Di động không hỗ trợ xuất PNG.

Trước khi chuyển thành Base, hãy lưu ghi chú và đưa bảng ra ngoài khối trích dẫn hoặc danh sách. Cấu trúc gộp sẽ được làm phẳng; khôi phục bảng gốc không xóa các ghi chú bản ghi đã tạo.

Hãy tách các ô gộp trong vùng dữ liệu trước khi chuyển bảng thành Base. Sau khi chuyển, đặt con trỏ trong khối Base và chạy **Tạo bản ghi trong Base hiện tại** để thêm một bản ghi trống.

### Bảng Markdown thông thường

Theo mặc định, bảng GFM thông thường sử dụng trình chỉnh sửa bảng của Obsidian. Bật “Chỉnh sửa cả bảng Markdown thông thường” để dùng các điều khiển của Structural Tables. Nếu một hàng dữ liệu có nhiều ô trong mã nguồn hơn số cột tiêu đề, một số nội dung có thể bị ẩn. Hãy chọn “Sửa mã Markdown của bảng” và xử lý các ô đó trước khi sửa cấu trúc.

### Công thức và ngắt dòng

Shift+Enter chèn ngắt dòng khi hiển thị, được lưu bằng cách viết `<br>` được hỗ trợ. Ký hiệu `|` chưa thoát trong công thức có thể bị hiểu thành dấu phân cách cột. Khi đó, plugin giữ nội dung đang sửa và từ chối lưu không an toàn. Hãy dùng lệnh TeX `\lvert`, `\rvert` hoặc `\mid` tùy theo ý nghĩa.

### Dán và sao chép

Plugin chỉ chuyển bảng HTML sang Markdown khi có thể giữ cấu trúc ô an toàn. Nếu không thể bảo toàn định dạng, nó có thể dán toàn bộ văn bản thuần thay thế hoặc để Obsidian xử lý thao tác dán. Văn bản thuần không giữ ô gộp hay kiểu chữ. Hãy kiểm tra cách hiển thị trong ứng dụng đích sau khi chuyển sang GFM thông thường.

### Chuyển sang GFM thông thường

Nhấp chuột phải vào bảng và chọn “Chuyển sang bảng GFM thông thường…”. Trong trình soạn thảo, bạn cũng có thể đặt con trỏ trong mã nguồn bảng rồi chạy lệnh chuyển sang GFM thông thường.

Nếu bảng chỉ có tiêu đề hàng, nên hoán đổi hàng và cột để chuyển các nhãn đó lên hàng tiêu đề trên cùng. Nếu giữ nguyên hướng mà không có tiêu đề cột, một hàng tiêu đề trống được thêm ở trên và mọi hàng dữ liệu được giữ lại.

Các ô đã gộp được tách ra. Nội dung của chúng được lặp lại tại từng vị trí đã bị che. Nhiều hàng tiêu đề được gộp thành một hàng. Các cấp tiêu đề được nối bằng “ / ”. Các tiêu đề hàng còn ở bên cạnh trở thành ô thông thường; GFM không giữ vai trò tiêu đề của chúng.

Chuyển giữa bản xem trước kết quả và mã nguồn Markdown, rồi sao chép kết quả hiện tại hoặc thay thế bảng gốc. Chế độ đọc chỉ cho phép sao chép. Việc thay thế là một thay đổi duy nhất và có thể phục hồi bằng một lần Hoàn tác; đóng cửa sổ không sửa mã nguồn. Hãy hoàn tất việc sửa ô trước. Nếu bảng hoặc tệp gốc thay đổi, hãy mở lại bản xem trước. Lệnh sao chép nhanh sang GFM dùng hướng được khuyên dùng.

### Giới hạn PNG và khôi phục Base

Ảnh PNG bị giới hạn 8192 pixel cho mỗi chiều hoặc tổng cộng 16 triệu pixel. Nếu không thể chụp đủ bảng, plugin không tạo ảnh bị cắt. Chuyển sang Base sẽ tạo các ghi chú bản ghi và tệp `_promotion.json` để khôi phục. Khôi phục bảng gốc không đưa các sửa đổi Base sau đó vào bảng và không xóa ghi chú đã tạo.

### Chuyển đổi bảng giữa Markdown và HTML

Đặt con trỏ trong bảng Markdown và chạy **Chuyển bảng Markdown hiện tại sang HTML…**. Để chuyển lại, đặt con trỏ trong khối `<table>…</table>` đầy đủ, độc lập ở trình soạn thảo mã nguồn Markdown rồi chạy **Chuyển bảng HTML hiện tại sang Markdown…**. Cả hai chiều đều có xem trước và chỉ thay thế sau khi xác nhận; có thể hoàn tác trong một bước.

Bảng dùng GFM thông thường nếu có thể, còn cấu trúc phức tạp dùng `<`, `^`, `||`. Liên kết, công thức hoặc văn bản có định dạng chưa hỗ trợ sẽ bị từ chối. Nếu mất màu, độ rộng hay thuộc tính HTML khác, bạn phải xác nhận rõ ràng. HTML kết quả chưa được chỉnh bằng trình sửa ô trực quan của plugin; hãy chuyển về Markdown để sửa cấu trúc.

<!-- section: settings -->
## Cài đặt

“Chung”: ngôn ngữ, dán HTML, cảnh báo xung đột. “Chế độ xem”: đọc, xem trước, kiểm tra lỗi và chỉnh sửa bảng GFM thường. “Giao diện”: kiểu, chiều rộng, khoảng cách và nền xen kẽ.

Chọn Theo chủ đề, Lưới hoặc Bảng ba đường kẻ. Đổi giao diện hay ngôn ngữ plugin không thay đổi Markdown hoặc hướng văn bản của ghi chú.

Bảng mẫu bên dưới “Đường kẻ và nền” và “Bố cục và khoảng cách” phản ánh thay đổi ngay lập tức. Bảng chỉ dùng văn bản cố định, không đọc hay sửa ghi chú. Cài đặt áp dụng cho các bảng trong toàn bộ kho và được lưu tự động.

<!-- section: limitations -->
## Giới hạn

Đây không phải ứng dụng bảng tính nên không tính công thức. Không hỗ trợ định dạng riêng từng ô, chú thích bảng, Markdown dạng khối trong ô hoặc ô có nhiều dòng mã nguồn thực sự.

HTML nhập vào được chuyển thành văn bản và dấu xuống dòng trực quan `<br>` được hỗ trợ. GFM thường không giữ mọi cấu trúc gộp; chuyển thành Base sẽ làm phẳng tiêu đề.

<!-- section: privacy-and-security -->
## Quyền riêng tư và bảo mật

Bảng được xử lý trên máy, không tải nội dung ghi chú lên mạng và không thu thập số liệu sử dụng. Chỉ xem bảng không làm thay đổi Markdown.

Hình ảnh và phông chữ trên mạng vẫn tuân theo hoạt động mạng của Obsidian và giao diện chủ đề. Không đăng công khai đường dẫn hoặc nội dung ghi chú cá nhân.

<!-- section: development -->
## Phát triển

Sử dụng Node 24.19.0 và npm 11.17.0. Cài đặt các gói phụ thuộc và chạy kiểm tra:

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## Hỗ trợ

Hỏi đáp tại Q&A, đề xuất tại Ideas và báo lỗi có thể tái hiện tại GitHub Issues. Hãy cung cấp phiên bản Obsidian, chủ đề, Markdown của bảng, kết quả mong đợi và kết quả thực tế.

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

Báo cáo lỗ hổng bảo mật qua kênh riêng thay vì đăng công khai.

<!-- section: license -->
## Giấy phép

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
