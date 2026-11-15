# 廚房專用表格系統

把三個舊系統整合成一個入口：

| 系統 | 整合方式 | 資料 |
|---|---|---|
| 冰箱溫度記錄表 | 內建（程式碼複製自 `..\冰箱溫度記錄表系統\web`） | 桌面版：`%APPDATA%\FridgeTemp`（和原本的單獨程式共用）；網頁版：瀏覽器 + Google 雲端 |
| 菜品銷售紀錄 | 內建（複製自 `..\菜品銷售紀錄系統\web`） | 桌面版：`%APPDATA%\DishSales`（共用）；網頁版：瀏覽器 + Google 雲端 |
| 員工餐金額總計 | 開啟原本的「碧水堂員工餐.exe」 | 首頁讀取 exe 旁的 `meal_data.json`；網頁版用同步密碼從雲端讀取（只讀） |

首頁儀表板顯示：今天冰箱記錄進度與異常、今日／本月銷售額、員工餐本期預算剩餘。
冰箱、菜品頁面左上角有「⌂ 首頁」按鈕（`portal/kitchen-nav.js`），回首頁前會先存檔。

## 檔案

- `portal/` 首頁（index.html、portal.js、portal.css、sw.js、kitchen-nav.js、config.js）
- `build_web.py` 組裝網站 → `site/`（首頁 + `fridge/` + `dish/`）。**冰箱、菜品改版後重新執行即可同步。**
- `desktop/main.py` 桌面版（pywebview）；依目前網址（/fridge/、/dish/）決定讀寫哪一份資料
- `build.py` → `dist\廚房專用表格系統.exe`

## 注意

- 桌面版和原本的冰箱／菜品單獨程式不能同時開（會提示先關掉另一個），避免兩邊同時寫入同一份資料。
- 員工餐程式位置：自動找 exe 同資料夾、原專案 `dist`、`C:\Users\admin\Desktop\廚房表單\碧水堂員工餐預算紀錄`；找不到時在首頁按「程式位置…」選擇，設定存在 `%APPDATA%\KitchenForms\config.json`。
- 首頁的員工餐「本期剩餘」沒扣初一／十六拜拜菜預扣，以員工餐程式顯示為準。

## 測試

```
python build_web.py
set KITCHEN_DATA=<測試資料夾>            (底下放 FridgeTemp\data.json、DishSales\data.json)
set KITCHEN_MEAL_EXE=<資料夾>\碧水堂員工餐.exe   (同資料夾放 meal_data.json；自我測試不會真的開啟)
set KITCHEN_EXPORT_DIR=<資料夾>
set KITCHEN_SELFTEST=<結果.json>
python desktop\main.py        或   dist\廚房專用表格系統.exe
```
