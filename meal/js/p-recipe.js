/* 頁面：食譜庫（可做的家常菜 / 我的食譜 ＋ 完整食譜編輯：配料、營養成分、步驟、照片） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).recipebook = P;
  P.alwaysRefresh = true;                    // 食材單價可能有更新 → 重新推算可做的家常菜

  const COURSES = ['開胃菜', '主菜', '湯品', '配菜', '主食', '甜點', '飲品', '早餐', '小吃'];
  const CUISINES = ['台式', '中式', '日式', '韓式', '西式', '泰式', '港式', '其他'];
  const DIFFS = ['簡單', '中等', '困難'];
  const NUT = [['calories', '熱量', '千卡'], ['protein', '蛋白質', '克'], ['fat', '總脂肪', '克'], ['carbs', '碳水化合物', '克'],
    ['sat_fat', '飽和脂肪', '克'], ['trans_fat', '反式脂肪', '克'], ['fiber', '膳食纖維', '克'], ['sugar', '糖', '克'],
    ['sodium', '鈉', '毫克'], ['cholesterol', '膽固醇', '毫克']];
  // 常見食材每 100 公克的營養素（概略估算值）
  const NUT_DB = {
    雞胸肉: [165, 31.0, 3.6, 0, 1.0, 0, 0, 0, 74, 85], 雞腿肉: [209, 18.6, 15.5, 0, 4.3, 0, 0, 0, 78, 95], 雞翅: [203, 18.3, 13.5, 0, 3.8, 0, 0, 0, 82, 84],
    雞絞肉: [143, 17.4, 8.1, 0, 2.3, 0, 0, 0, 70, 80], 雞蛋: [143, 12.6, 9.5, 0.7, 3.1, 0, 0, 0.4, 142, 373], 五花肉: [518, 9.3, 53.0, 0, 19.0, 0, 0, 0, 41, 73],
    三層肉: [518, 9.3, 53.0, 0, 19.0, 0, 0, 0, 41, 73], 梅花肉: [242, 27.0, 14.0, 0, 5.1, 0, 0, 0, 62, 80], 豬肉: [242, 27.0, 14.0, 0, 5.1, 0, 0, 0, 62, 80],
    豬絞肉: [263, 17.0, 21.0, 0, 7.7, 0, 0, 0, 58, 72], 絞肉: [263, 17.0, 21.0, 0, 7.7, 0, 0, 0, 58, 72], 排骨: [277, 19.0, 22.0, 0, 8.0, 0, 0, 0, 60, 80],
    牛肉: [250, 26.0, 15.0, 0, 6.0, 0, 0, 0, 60, 90], 牛絞肉: [254, 17.0, 20.0, 0, 7.9, 0, 0, 0, 66, 78], 羊肉: [294, 25.0, 21.0, 0, 9.0, 0, 0, 0, 72, 97],
    鴨肉: [337, 19.0, 28.4, 0, 9.7, 0, 0, 0, 63, 84], 鮭魚: [208, 20.0, 13.0, 0, 3.1, 0, 0, 0, 59, 55], 魚: [100, 20.0, 1.7, 0, 0.4, 0, 0, 0, 54, 50],
    蝦: [99, 24.0, 0.3, 0.2, 0.1, 0, 0, 0, 111, 189], 花枝: [92, 15.6, 1.4, 3.1, 0.4, 0, 0, 0, 44, 233], 透抽: [92, 15.6, 1.4, 3.1, 0.4, 0, 0, 0, 44, 233],
    魷魚: [92, 15.6, 1.4, 3.1, 0.4, 0, 0, 0, 44, 233], 蛤蜊: [86, 14.7, 1.0, 3.6, 0.1, 0, 0, 0, 601, 34], 牛奶: [61, 3.2, 3.3, 4.8, 1.9, 0, 0, 5.1, 43, 10],
    起司: [402, 25.0, 33.0, 1.3, 21.0, 0, 0, 0.5, 621, 105], 豆腐: [76, 8.0, 4.8, 1.9, 0.7, 0, 0.3, 0.6, 7, 0], 豆干: [140, 16.2, 7.6, 3.0, 1.1, 0, 0.5, 0, 320, 0],
    高麗菜: [25, 1.3, 0.1, 5.8, 0, 0, 2.5, 3.2, 18, 0], 空心菜: [19, 2.6, 0.2, 3.1, 0, 0, 2.1, 0, 61, 0], 青江菜: [13, 1.5, 0.2, 2.2, 0, 0, 1.0, 1.2, 65, 0],
    花椰菜: [34, 2.8, 0.4, 6.6, 0, 0, 2.6, 1.7, 33, 0], 番茄: [18, 0.9, 0.2, 3.9, 0, 0, 1.2, 2.6, 5, 0], 洋蔥: [40, 1.1, 0.1, 9.3, 0, 0, 1.7, 4.2, 4, 0],
    紅蘿蔔: [41, 0.9, 0.2, 9.6, 0, 0, 2.8, 4.7, 69, 0], 白蘿蔔: [18, 0.6, 0.1, 4.1, 0, 0, 1.6, 2.5, 21, 0], 小黃瓜: [15, 0.7, 0.1, 3.6, 0, 0, 0.5, 1.7, 2, 0],
    苦瓜: [17, 1.0, 0.2, 3.7, 0, 0, 2.8, 1.0, 6, 0], 茄子: [25, 1.0, 0.2, 6.0, 0, 0, 3.0, 3.5, 2, 0], 青椒: [20, 0.9, 0.2, 4.6, 0, 0, 1.7, 2.4, 3, 0],
    菠菜: [23, 2.9, 0.4, 3.6, 0, 0, 2.2, 0.4, 79, 0], 豆芽: [30, 3.0, 0.2, 5.9, 0, 0, 1.8, 3.4, 6, 0], 蔥: [32, 1.8, 0.2, 7.3, 0, 0, 2.6, 2.3, 16, 0],
    薑: [80, 1.8, 0.8, 17.8, 0, 0, 2.0, 1.7, 13, 0], 蒜: [149, 6.4, 0.5, 33.0, 0, 0, 2.1, 1.0, 17, 0], 辣椒: [40, 1.9, 0.4, 8.8, 0, 0, 1.5, 5.3, 9, 0],
    九層塔: [23, 3.2, 0.6, 2.7, 0, 0, 1.6, 0.3, 4, 0], 香菜: [23, 2.1, 0.5, 3.7, 0, 0, 2.8, 0.9, 46, 0], 白米: [130, 2.7, 0.3, 28.0, 0.1, 0, 0.4, 0.1, 1, 0],
    米飯: [130, 2.7, 0.3, 28.0, 0.1, 0, 0.4, 0.1, 1, 0], 麵條: [138, 4.5, 0.9, 27.0, 0.2, 0, 1.8, 0.6, 6, 0], 冬粉: [90, 0.1, 0.1, 22.0, 0, 0, 0, 0, 5, 0],
    玉米澱粉: [381, 0.3, 0.1, 91.0, 0, 0, 0.9, 0, 9, 0], 太白粉: [335, 0.1, 0, 84.0, 0, 0, 0, 0, 3, 0], 麵粉: [364, 10.3, 1.0, 76.0, 0.2, 0, 2.7, 0.3, 2, 0],
    馬鈴薯: [77, 2.0, 0.1, 17.0, 0, 0, 2.2, 0.8, 6, 0], 地瓜: [86, 1.6, 0.1, 20.0, 0, 0, 3.0, 4.2, 55, 0], 醬油: [60, 8.1, 0.1, 5.6, 0, 0, 0.8, 0.4, 5493, 0],
    米酒: [127, 0.1, 0, 0.4, 0, 0, 0, 0, 3, 0], 糖: [387, 0, 0, 100.0, 0, 0, 0, 100.0, 1, 0], 鹽: [0, 0, 0, 0, 0, 0, 0, 0, 38758, 0],
    胡椒粉: [251, 10.4, 3.3, 64.0, 1.4, 0, 26.5, 0.6, 20, 0], 五香粉: [375, 10.0, 13.0, 60.0, 4.0, 0, 30.0, 2.0, 60, 0], 香油: [884, 0, 100.0, 0, 14.2, 0, 0, 0, 0, 0],
    麻油: [884, 0, 100.0, 0, 14.2, 0, 0, 0, 0, 0], 沙拉油: [884, 0, 100.0, 0, 12.0, 0, 0, 0, 0, 0], 食用油: [884, 0, 100.0, 0, 12.0, 0, 0, 0, 0, 0],
    橄欖油: [884, 0, 100.0, 0, 13.8, 0, 0, 0, 2, 0], 烏醋: [19, 0, 0, 4.3, 0, 0, 0, 0.4, 9, 0], 醋: [19, 0, 0, 4.3, 0, 0, 0, 0.4, 9, 0],
    味素: [0, 0, 0, 0, 0, 0, 0, 0, 12000, 0], 蠔油: [51, 1.4, 0.3, 11.0, 0, 0, 0, 8.0, 2733, 1], 甜辣醬: [145, 0.8, 0.2, 35.0, 0, 0, 1.0, 27.0, 800, 0],
    番茄醬: [101, 1.7, 0.2, 25.8, 0, 0, 1.5, 22.0, 907, 0], 沙茶醬: [550, 10.0, 50.0, 15.0, 8.0, 0, 3.0, 5.0, 900, 0], 沙茶: [550, 10.0, 50.0, 15.0, 8.0, 0, 3.0, 5.0, 900, 0],
    蘋果: [52, 0.3, 0.2, 14.0, 0, 0, 2.4, 10.0, 1, 0], 香蕉: [89, 1.1, 0.3, 23.0, 0, 0, 2.6, 12.0, 1, 0], 檸檬: [29, 1.1, 0.3, 9.3, 0, 0, 2.8, 2.5, 2, 0],
  };
  const UNIT_G = { 克: 1, 公克: 1, g: 1, 毫克: 0.001, mg: 0.001, 公斤: 1000, kg: 1000, 斤: 600, 台斤: 600, 兩: 37.5, 毫升: 1, ml: 1, cc: 1, 杯: 200, 碗: 250, 大匙: 15, 湯匙: 15, 小匙: 5, 茶匙: 5 };
  const nutLookup = (name) => {
    name = String(name || '').trim();
    let best = null;
    for (const [k, v] of Object.entries(NUT_DB)) if (k.includes(name) || name.includes(k)) { if (name && (!best || k.length > best[0].length)) best = [k, v]; }
    return best ? best[1] : null;
  };
  const calcNutrition = (rec) => {
    const tot = Object.fromEntries(NUT.map(([k]) => [k, 0]));
    let matched = 0;
    const ings = rec.ingredients || [];
    for (const ing of ings) {
      const name = String(ing.name || '').trim(), unit = String(ing.unit || '').trim(), qty = ing.qty;
      if (!name || qty == null || !(unit in UNIT_G)) continue;
      const nut = nutLookup(name);
      if (!nut) continue;
      const f = qty * UNIT_G[unit] / 100;
      NUT.forEach(([k], i) => { tot[k] += nut[i] * f; });
      matched++;
    }
    const sv = rec.servings;
    for (const k of Object.keys(tot)) tot[k] = Math.round((sv && sv > 0 ? tot[k] / sv : tot[k]) * 10) / 10;
    return [tot, matched, ings.length];
  };
  const blank = () => ({ description: '', course: '', cuisine: '', difficulty: '中等', servings: null, prep_min: null, cook_min: null, source: '',
    cover_image: '', ingredients: [], steps: [], nutrition: Object.fromEntries(NUT.map(([k]) => [k, null])) });
  M.recipeIngredientsStr = (r) => (r.ingredients || []).map((i) => String(i.name || '').trim()).filter(Boolean).join(',');
  const syncSimple = (name, r) => { const it = M.recipeIngredientsStr(r); if (it) (M.data.recipes = M.data.recipes || {})[name] = it; };

  // ── 可做的家常菜（依「食材單價」裡買過的食材推薦）──
  const EGG = ['雞蛋', '洗選蛋', '土雞蛋'], MINC = ['絞肉', '絞梅肉', '豬絞', '梅花絞'], PORK = ['三層肉', '五花', '梅花肉', '豬肉', '胛心', '肉片'];
  const CHKN = ['雞腿', '清腿', '雞肉', '雞胸', '棒腿', '雞丁', '雞翅'], FISH = ['鱸魚', '吳郭魚', '鯛魚', '虱目魚', '鯖魚', '魚排', '魚片', '午仔魚'];
  const TOMA = ['番茄', '蕃茄'], WB = ['勿仔魚', '吻仔魚', '魩仔魚', '銀魚'], GOURD = ['蒲瓜', '扁蒲', '瓠瓜'];
  const d = (name, course, need, season) => ({ name, course, need, season });
  const HOMECOOK = [
    d('番茄炒蛋', '主菜', [TOMA, EGG], ['蔥', '糖', '鹽']), d('洋蔥炒蛋', '主菜', [['洋蔥'], EGG], ['鹽', '黑胡椒']),
    d('菜脯蛋', '主菜', [['菜脯', '蘿蔔乾'], EGG], ['蔥']), d('韭菜炒蛋', '主菜', [['韭菜'], EGG], ['鹽']),
    d('蝦仁炒蛋', '主菜', [['蝦仁'], EGG], ['蔥', '米酒']), d('皮蛋豆腐', '主菜', [['皮蛋'], ['豆腐']], ['醬油膏', '蔥', '柴魚片']),
    d('麻婆豆腐', '主菜', [['豆腐'], MINC], ['豆瓣醬', '蒜', '蔥']), d('家常豆腐', '主菜', [['豆腐'], ['肉絲', ...MINC]], ['醬油', '蒜', '蔥']),
    d('花瓜蒸肉', '主菜', [['花瓜', '瓜仔'], MINC], ['醬油', '蒜']), d('肉燥', '主菜', [MINC], ['醬油', '紅蔥頭', '冰糖']),
    d('鹹魚蒸肉餅', '主菜', [['鹹魚'], MINC], ['薑', '米酒']), d('蒼蠅頭', '主菜', [['韭菜花'], MINC], ['豆豉', '辣椒', '蒜']),
    d('魚香茄子', '主菜', [['茄子'], MINC], ['豆瓣醬', '蒜', '蔥']), d('滷肉', '主菜', [['三層肉', '五花']], ['醬油', '冰糖', '米酒']),
    d('蒜泥白肉', '主菜', [['三層肉', '五花']], ['蒜泥', '醬油膏']), d('回鍋肉', '主菜', [['三層肉', '五花'], ['高麗菜']], ['豆瓣醬', '蒜']),
    d('客家小炒', '主菜', [['豆干'], ['三層肉', '五花']], ['芹菜', '蔥', '醬油']), d('豆干炒肉絲', '主菜', [['豆干'], ['肉絲']], ['醬油', '蒜', '辣椒']),
    d('洋蔥炒肉絲', '主菜', [['洋蔥'], ['肉絲']], ['醬油', '黑胡椒']), d('青椒炒肉絲', '主菜', [['青椒'], ['肉絲']], ['醬油', '蒜']),
    d('豆芽炒肉絲', '主菜', [['豆芽'], ['肉絲']], ['蔥', '鹽']), d('馬鈴薯燉肉', '主菜', [['馬鈴薯'], PORK], ['醬油', '紅蘿蔔']),
    d('糖醋排骨', '主菜', [['排骨']], ['番茄醬', '白醋', '糖']), d('三杯雞', '主菜', [CHKN], ['麻油', '醬油', '米酒', '九層塔']),
    d('滷雞腿', '主菜', [CHKN], ['醬油', '冰糖', '八角']), d('香煎雞腿排', '主菜', [CHKN], ['鹽', '黑胡椒', '米酒']),
    d('宮保雞丁', '主菜', [CHKN], ['乾辣椒', '花生', '醬油']), d('洋蔥燒雞', '主菜', [CHKN, ['洋蔥']], ['醬油', '米酒']),
    d('咖哩雞', '主菜', [CHKN, ['馬鈴薯', '洋蔥']], ['咖哩塊', '紅蘿蔔']), d('洋蔥炒牛肉', '主菜', [['牛肉'], ['洋蔥']], ['醬油', '黑胡椒']),
    d('番茄燉牛肉', '主菜', [['牛肉'], TOMA], ['洋蔥', '醬油']), d('紅燒魚', '主菜', [FISH], ['醬油', '薑', '蔥']),
    d('蛤蜊蒸蛋', '主菜', [['蛤蜊'], EGG], ['鹽', '蔥']),
    d('炒高麗菜', '配菜', [['高麗菜']], ['蒜', '鹽']), d('高麗菜炒肉絲', '配菜', [['高麗菜'], ['肉絲']], ['蒜', '鹽']),
    d('番茄炒高麗菜', '配菜', [TOMA, ['高麗菜']], ['蒜', '鹽']), d('蒜炒空心菜', '配菜', [['空心菜']], ['蒜', '鹽']),
    d('沙茶炒空心菜', '配菜', [['空心菜']], ['沙茶醬', '蒜']), d('蒜炒莧菜', '配菜', [['莧菜']], ['蒜', '鹽']),
    d('皮蛋莧菜', '配菜', [['莧菜'], ['皮蛋']], ['蒜', '高湯']), d('莧菜吻仔魚', '配菜', [['莧菜'], WB], ['蒜', '太白粉']),
    d('蒲瓜炒肉絲', '配菜', [GOURD, ['肉絲']], ['蒜', '鹽']), d('吻仔魚炒蒲瓜', '配菜', [GOURD, WB], ['蒜', '鹽']),
    d('吻仔魚炒蛋', '配菜', [WB, EGG], ['蔥', '鹽']), d('滷豆干', '配菜', [['豆干']], ['醬油', '冰糖', '八角']),
    d('蔥燒豆腐', '配菜', [['豆腐']], ['醬油', '蔥']), d('蒸蛋', '配菜', [EGG], ['鹽', '蔥']),
    d('三杯豬血糕', '配菜', [['豬血糕', '米血']], ['麻油', '醬油', '九層塔']), d('炒青江菜', '配菜', [['青江菜']], ['蒜', '鹽']),
    d('炒地瓜葉', '配菜', [['地瓜葉']], ['蒜', '鹽']), d('炒菠菜', '配菜', [['菠菜']], ['蒜', '鹽']),
    d('開陽白菜', '配菜', [['白菜']], ['蝦米', '蒜']), d('苦瓜鹹蛋', '配菜', [['苦瓜'], ['鹹蛋']], ['蒜', '蔥']),
    d('絲瓜蛤蜊', '配菜', [['絲瓜'], ['蛤蜊']], ['薑絲']), d('紅蘿蔔炒蛋', '配菜', [['紅蘿蔔'], EGG], ['蔥', '鹽']),
    d('番茄蛋花湯', '湯品', [TOMA, EGG], ['蔥', '鹽']), d('番茄豆腐湯', '湯品', [TOMA, ['豆腐']], ['蔥', '鹽']),
    d('酸辣湯', '湯品', [['豆腐'], EGG, ['肉絲']], ['烏醋', '胡椒粉', '太白粉']), d('莧菜豆腐羹', '湯品', [['莧菜'], ['豆腐']], ['太白粉', '蒜']),
    d('高麗菜湯', '湯品', [['高麗菜']], ['鹽', '香油']), d('蘿蔔排骨湯', '湯品', [['白蘿蔔', '蘿蔔'], ['排骨']], ['鹽', '薑']),
    d('玉米排骨湯', '湯品', [['玉米'], ['排骨']], ['鹽', '薑']), d('紫菜蛋花湯', '湯品', [['紫菜'], EGG], ['蔥', '鹽']),
    d('味噌豆腐湯', '湯品', [['味噌'], ['豆腐']], ['蔥', '柴魚片']), d('麻油雞湯', '湯品', [CHKN], ['麻油', '老薑', '米酒']),
    d('鹹魚炒飯', '主食', [['鹹魚'], EGG], ['白飯', '蔥']), d('皮蛋瘦肉粥', '主食', [['皮蛋'], ['肉絲', ...MINC]], ['白米', '薑絲', '蔥']),
  ];
  const COURSE_ICON = { 主菜: '🍖', 配菜: '🥬', 湯品: '🍲', 主食: '🍚' };
  const homecookMatches = () => {
    const last = {};
    for (const r of [...M.data.ingredients].sort(M.sortByDateId)) {
      if (r.category === '早餐') { delete last[r.name]; continue; }
      last[r.name] = [r.unit || '', r.price];
    }
    const names = Object.keys(last);
    const ready = [], near = [];
    for (const dish of HOMECOOK) {
      const used = [], missing = [];
      for (const alts of dish.need) {
        const hit = names.find((n) => alts.some((a) => n.includes(a)));
        if (hit) { const [unit, price] = last[hit]; used.push([hit, `${hit} $${M.num(price, true)}` + (unit ? `/${unit}` : '')]); }
        else missing.push(alts[0]);
      }
      if (!missing.length) ready.push([dish, used, missing]);
      else if (missing.length === 1 && used.length) near.push([dish, used, missing]);
    }
    return [ready, near, names.length];
  };

  // ── 頁面 ──
  let mode = 'homecook', els = {};
  P.build = (el) => {
    const bHome = ui.btn('🥘 可做的家常菜', 'muted', () => setMode('homecook'));
    const bMine = ui.btn('📖 我的食譜', 'muted', () => setMode('mine'));
    const search = ui.input('', { style: { width: '170px' } });
    search.addEventListener('input', () => P.refresh());
    el.appendChild(h('div.toolbar', h('div.tb-l', bHome, bMine, h('span', { style: { width: '6px' } }), ui.btn('＋ 新增食譜', 'green', () => editor(null))),
      h('div.tb-r', h('span.tb-lbl', '搜尋菜名'), search)));
    const list = h('div.rb-list');
    const sc = h('div.scroll', list);
    el.appendChild(sc);
    els = { bHome, bMine, search, list, sc };
    P.searchInput = search;
  };
  const setMode = (m) => { mode = m; els.sc.scrollTop = 0; P.refresh(); };
  P.refresh = () => {
    if (!els.list) return;
    els.bHome.className = 'btn ' + (mode === 'homecook' ? 'blue' : 'muted');
    els.bMine.className = 'btn ' + (mode === 'mine' ? 'blue' : 'muted');
    ui.clear(els.list);
    if (mode === 'homecook') renderHomecook(); else renderMine();
  };
  const renderMine = () => {
    const q = els.search.value.trim().toLowerCase();
    const book = M.data.recipe_book || {};
    const names = Object.keys(book).filter((n) => n.toLowerCase().includes(q)).sort();
    if (!names.length) { els.list.appendChild(h('div.gempty', q ? '找不到符合的食譜。' : '還沒有食譜，按「＋ 新增食譜」建立第一筆。')); return; }
    for (const name of names) {
      const r = book[name];
      const thumb = h('div.rb-thumb', '🍽');
      M.loadImg(r.cover_image, thumb);
      const tags = [r.cuisine, r.course, r.difficulty].filter(Boolean).join('  ·  ');
      const det = `配料 ${(r.ingredients || []).length} 項 · 步驟 ${(r.steps || []).length} 個`;
      const row = h('div.rb-row', thumb, h('div.rb-info', h('b', name), h('div.sub', tags ? `${tags}   ${det}` : det)),
        h('div.rb-btns', ui.btn('✏ 編輯', 'muted', () => editor(name)), Object.assign(ui.btn('✕', 'red', () => delRecipe(name)), { className: 'btn red x' })));
      row.addEventListener('dblclick', () => editor(name));
      els.list.appendChild(row);
    }
  };
  const renderHomecook = () => {
    const q = els.search.value.trim().toLowerCase();
    let [ready, near, n] = homecookMatches();
    if (q) { ready = ready.filter((x) => x[0].name.toLowerCase().includes(q)); near = near.filter((x) => x[0].name.toLowerCase().includes(q)); }
    els.list.appendChild(h('div.rb-intro', `依「食材單價」裡的 ${n} 種食材推薦（早餐類成品不算；蔥薑蒜、醬油等調味料視為常備）。按「＋ 加入食譜庫」會開啟新增食譜，並自動查愛料理的做法。`));
    if (!n) { els.list.appendChild(h('div.gempty', '食材單價還沒有資料，先到「食材單價」新增貨單吧。')); return; }
    if (!ready.length && !near.length) { els.list.appendChild(h('div.gempty', '找不到符合的家常菜。')); return; }
    const order = { 主菜: 0, 配菜: 1, 湯品: 2, 主食: 3 };
    const book = M.data.recipe_book || {};
    for (const [title, color, items] of [['✅ 現有食材就能做', 'var(--accent2)', ready], ['🛒 再買一樣就能做', 'var(--warning)', near]]) {
      if (!items.length) continue;
      els.list.appendChild(h('div.rb-sec', { style: { color } }, `${title}（${items.length} 道）`));
      for (const [dish, used, missing] of [...items].sort((a, b) => (order[a[0].course] ?? 9) - (order[b[0].course] ?? 9))) {
        const inBook = dish.name in book;
        const row = h('div.rb-row', h('div.rb-thumb', COURSE_ICON[dish.course] || '🍽'),
          h('div.rb-info', h('div', h('b', dish.name), h('span.sub', { style: { marginLeft: '8px' } }, dish.course), inBook ? h('span.in', '📖 已在我的食譜') : null),
            h('div.ok', '用到：' + used.map((u) => u[1]).join('、')),
            missing.length ? h('div.miss', '還缺：' + missing.join('、')) : null,
            dish.season ? h('div.sub', '調味：' + dish.season.join('、')) : null),
          h('div.rb-btns', inBook ? ui.btn('✏ 查看食譜', 'muted', () => editor(dish.name)) : ui.btn('＋ 加入食譜庫', 'blue', () => addHomecook(dish, used))));
        if (!inBook) row.addEventListener('dblclick', () => addHomecook(dish, used));
        els.list.appendChild(row);
      }
    }
  };
  const addHomecook = async (dish, used) => {
    await editor(null, { name: dish.name, course: dish.course, cuisine: '台式', ingredients: [...used.map((u) => u[0]), ...(dish.season || [])] });
    if (dish.name in (M.data.recipe_book || {})) ui.status(`已把「${dish.name}」加入我的食譜`);
  };
  const delRecipe = async (name) => {
    if (!(await ui.ask('刪除食譜', `確定要刪除食譜「${name}」？\n（不會動到菜單排程裡已經排過的配菜資料）`))) return;
    delete (M.data.recipe_book || {})[name];
    M.save(); P.refresh(); M.refreshPage('menu');
    ui.status(`已刪除食譜「${name}」`);
  };

  // ════════════════════════════════════════════════════════════ 新增 / 編輯完整食譜
  const editor = (name, preset = null) => new Promise((resolve) => {
    const isNew = name == null;
    const orig = name ? (M.data.recipe_book || {})[name] : null;
    const rec = orig ? M.clone(orig) : blank();
    preset = preset || {};
    if (isNew && Object.keys(preset).length) { rec.course = preset.course || ''; rec.cuisine = preset.cuisine || ''; }
    rec.ingredients = rec.ingredients || []; rec.steps = rec.steps || []; rec.nutrition = rec.nutrition || {};
    const numv = (v) => (v ? M.num(v) : '');
    const cover = h('div.rec-cover', { title: '點一下選擇封面圖片' });
    const refreshCover = () => { ui.clear(cover); cover.textContent = '🖼\n選擇封面'; M.loadImg(rec.cover_image, cover); };
    const pickCover = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = pickCover.files[0]; pickCover.value = '';
      if (!f) return;
      const fn = await M.saveImage(f);
      if (fn) { rec.cover_image = fn; refreshCover(); }
    } });
    cover.addEventListener('click', () => pickCover.click());
    refreshCover();
    const lookupSt = h('span', { style: { color: 'var(--purple)', fontSize: '11px', marginLeft: 'auto' } });
    const nameI = ui.input(name || preset.name || '', { style: { fontWeight: 700, fontSize: '16px' } });
    const desc = ui.input(rec.description || '');
    const course = ui.input(rec.course || ''), cuisine = ui.input(rec.cuisine || '');
    const diff = ui.select(DIFFS, rec.difficulty || '中等');
    const source = ui.input(rec.source || '');
    const servings = ui.input(numv(rec.servings), { inputmode: 'decimal' }), prep = ui.input(numv(rec.prep_min), { inputmode: 'decimal' }), cook = ui.input(numv(rec.cook_min), { inputmode: 'decimal' });
    const top = h('div.rec-top', h('div', cover, pickCover),
      h('div', h('div', { style: { display: 'flex', alignItems: 'baseline' } }, h('span.fld-l', '食譜名稱'), lookupSt), nameI,
        ui.field('描述', desc),
        h('div.rec-grid4', ui.field('課程', ui.combo(course, () => COURSES)), ui.field('菜系', ui.combo(cuisine, () => CUISINES)), ui.field('難度', diff), ui.field('來源', source)),
        h('div.rec-meta', h('label', '份數', servings), h('label', '準備(分)', prep), h('label', '烹飪(分)', cook))));
    // 配料
    const ingList = h('div.lst');
    const renderIngs = () => {
      ui.clear(ingList);
      rec.ingredients.forEach((ing, i) => {
        const qs = ing.qty != null ? M.num(ing.qty, true) : '';
        const e = ui.btn('✎', 'muted', () => ingDialog('編輯配料', ing).then((r) => { if (r) { rec.ingredients[i] = r; renderIngs(); } }));
        const x = ui.btn('✕', 'red', () => { rec.ingredients.splice(i, 1); renderIngs(); });
        e.className = 'btn muted x'; x.className = 'btn red x';
        ingList.appendChild(h('div.ing-row', h('span', `${qs} ${ing.unit || ''} ${ing.name || ''}`.trim()), e, x));
      });
      if (!rec.ingredients.length) ingList.appendChild(h('div.muted-note', { style: { textAlign: 'center', padding: '10px' } }, '還沒有配料'));
    };
    // 營養成分
    const nutList = h('div.lst');
    const renderNut = () => {
      ui.clear(nutList);
      for (const [k, label, unit] of NUT) {
        const v = rec.nutrition[k];
        nutList.appendChild(h('div.nut-row', h('span', label), h('b', v != null && v !== '' ? `${M.num(v, true)} ${unit}` : '—')));
      }
    };
    nutList.addEventListener('dblclick', () => editNut());
    const editNut = () => nutDialog(rec.nutrition).then((r) => { if (r) { rec.nutrition = r; renderNut(); } });
    const autoNut = async () => {
      if (!rec.ingredients.length) { ui.info('提示', '請先新增配料，才能自動估算營養成分。'); return; }
      const sv = Number(servings.value.trim());
      rec.servings = servings.value.trim() && isFinite(sv) ? sv : null;
      const [tot, matched, n] = calcNutrition(rec);
      if (!matched) { ui.info('無法估算', '目前的配料都沒有比對到內建食材資料庫，或是用「顆／份／把」這類跟食材大小差異很大、無法概算重量的單位。\n可以用「✎ 編輯」自行輸入。'); return; }
      const per = rec.servings ? '每份' : '整份食譜';
      if (!(await ui.ask('自動計算營養成分', `根據 ${matched}/${n} 項配料估算出${per}的營養成分（其餘配料因為沒有比對到食材資料庫、或單位不是重量／容量而略過）。\n這是概略估算值，僅供參考；套用後會覆蓋目前的營養成分內容，要繼續嗎？`))) return;
      rec.nutrition = tot; renderNut();
      ui.status(`已自動估算營養成分（${matched}/${n} 項配料）`);
    };
    // 步驟
    const stepList = h('div.lst');
    const renderSteps = () => {
      ui.clear(stepList);
      rec.steps.forEach((st, i) => {
        const img = h('div');
        if (st.image) { const im = h('div.rb-thumb', { style: { width: '120px', height: '90px', marginTop: '6px' } }); M.loadImg(st.image, im); img.appendChild(im); }
        const e = ui.btn('✎ 編輯', 'muted', () => stepDialog('編輯步驟', st).then((r) => { if (r) { rec.steps[i] = r; renderSteps(); } }));
        const x = ui.btn('✕ 刪除', 'red', () => { rec.steps.splice(i, 1); renderSteps(); });
        e.classList.add('sm'); x.classList.add('sm');
        stepList.appendChild(h('div.step-card', h('div.t', h('span.no', i + 1), h('span', { style: { whiteSpace: 'pre-wrap' } }, st.text || '')), img, h('div.b', e, x)));
      });
      if (!rec.steps.length) stepList.appendChild(h('div.muted-note', { style: { textAlign: 'center', padding: '10px' } }, '還沒有步驟'));
    };
    const cols = h('div.rec-cols',
      h('div.rec-col', h('h4', '配料'), ingList, ui.btn('＋ 新增配料', 'muted', () => ingDialog('新增配料').then((r) => { if (r) { rec.ingredients.push(r); renderIngs(); } }))),
      h('div.rec-col', h('h4', '營養成分'), h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
        Object.assign(ui.btn('📊 自動計算', 'muted', autoNut), { className: 'btn muted sm' }), Object.assign(ui.btn('✎ 編輯', 'muted', editNut), { className: 'btn muted sm' })),
        nutList, h('div.muted-note', '雙擊資料可編輯；「📊 自動計算」依配料概略估算，僅供參考')),
      h('div.rec-col', h('h4', '步驟'), stepList, ui.btn('＋ 新增步驟', 'muted', () => stepDialog('新增步驟').then((r) => { if (r) { rec.steps.push(r); renderSteps(); } }))));
    renderIngs(); renderNut(); renderSteps();
    let saved = false;
    const save = async () => {
      const nn = nameI.value.trim();
      if (!nn) { await ui.warn('必填欄位', '請輸入食譜名稱。'); return; }
      const book = (M.data.recipe_book = M.data.recipe_book || {});
      if (nn !== name && nn in book && !(await ui.ask('名稱重複', `已經有食譜叫「${nn}」，要覆蓋嗎？`))) return;
      const fnum = (i) => { const t = i.value.trim(); const v = Number(t); return t && isFinite(v) ? v : null; };
      Object.assign(rec, { description: desc.value.trim(), course: course.value.trim(), cuisine: cuisine.value.trim(), difficulty: diff.value || '中等',
        source: source.value.trim(), servings: fnum(servings), prep_min: fnum(prep), cook_min: fnum(cook) });
      if (!isNew && name !== nn) delete book[name];
      book[nn] = rec;
      syncSimple(nn, rec);
      M.save();
      saved = true; m.close();
      P.refresh(); M.refreshPage('menu');
      ui.status(`食譜「${nn}」已儲存`);
    };
    const m = ui.modal({ title: isNew ? '新增食譜' : `編輯食譜－${name}`, width: 1020, body: h('div', top, cols), clickOut: false,
      buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '✓  儲存', kind: 'blue', onclick: save }],
      onClose: () => resolve(saved) });
    // 輸入食譜名稱 → 自動查「愛料理」帶入配料／步驟／封面（食譜還是空的才查）
    let busy = false;
    const isBlank = () => !rec.ingredients.length && !rec.steps.length && !rec.cover_image;
    const lookup = async () => {
      const dish = nameI.value.trim();
      if (!dish || busy || M.lookupSuspended() || !M.settings().recipe_lookup_enabled || !M.cloud.enabled || !isBlank()) return;
      busy = true; lookupSt.textContent = '🔍 查詢食譜中…';
      try {
        const res = await M.icookFull(dish);
        busy = false;
        if (m.closed) return;
        if (nameI.value.trim() !== dish || !isBlank()) { lookupSt.textContent = ''; return; }
        rec.ingredients = res.ingredients; rec.steps = res.steps;
        if (res.cover_image) { rec.cover_image = res.cover_image; refreshCover(); }
        if (res.servings && !servings.value.trim()) servings.value = M.num(res.servings);
        if (!source.value.trim()) source.value = res.source_url || '';
        renderIngs(); renderSteps();
        lookupSt.textContent = `已從愛料理帶入 ${rec.ingredients.length} 項食材、${rec.steps.length} 個步驟`;
      } catch (e) {
        busy = false; lookupSt.textContent = '';
        M.suspendLookup();
        if (!m.closed) ui.info('查詢失敗', `愛料理查詢失敗，本次已停用自動查詢：\n${e.message || e}`);
      }
    };
    nameI.addEventListener('blur', lookup);
    nameI.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); lookup(); } });
    if (isNew && preset.name) {
      if (M.settings().recipe_lookup_enabled && !M.lookupSuspended() && M.cloud.enabled) setTimeout(lookup, 200);
      else if (preset.ingredients) { rec.ingredients = preset.ingredients.map((n) => ({ qty: 1, unit: '', name: n })); renderIngs(); }
    }
    setTimeout(() => nameI.focus(), 40);
  });

  const ingDialog = (title, def = null) => new Promise((res) => {
    def = def || {};
    const qty = ui.input(def.qty ? M.num(def.qty) : '', { inputmode: 'decimal', style: { width: '90px', textAlign: 'center' } });
    const unit = ui.input(def.unit || '', { style: { width: '90px' } });
    const name = ui.input(def.name || '');
    let out = null;
    const ok = async () => {
      const nm = name.value.trim();
      if (!nm) { await ui.warn('必填欄位', '請輸入品名。'); return; }
      const t = qty.value.trim(), q = Number(t);
      if (t && !isFinite(q)) { await ui.error('格式錯誤', '數量必須是數字。'); return; }
      out = { qty: t ? q : null, unit: unit.value.trim(), name: nm }; m.close();
    };
    const m = ui.modal({ title, width: 420, body: h('div', { style: { display: 'grid', gridTemplateColumns: '90px 100px 1fr', gap: '8px' } },
      ui.field('數量', qty), ui.field('單位', ui.combo(unit, () => M.UNITS)), ui.field('品名', name)), clickOut: false, onClose: () => res(out),
    buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確  認', kind: 'blue', onclick: ok }] });
    for (const x of [qty, unit, name]) x.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && !(x._comboOpen && x._comboOpen())) { e.preventDefault(); ok(); } });
    setTimeout(() => qty.focus(), 40);
  });
  const stepDialog = (title, def = null) => new Promise((res) => {
    def = def || {};
    const txt = h('textarea', { rows: 7 }, def.text || '');
    let img = def.image || '';
    const st = h('span.sub', img ? '已選擇照片' : '未選擇照片');
    const prev = h('div.rb-thumb', { style: { width: '90px', height: '68px', display: img ? 'flex' : 'none' } });
    if (img) M.loadImg(img, prev);
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      const fn = await M.saveImage(f);
      if (fn) { img = fn; st.textContent = '已選擇照片'; prev.style.display = 'flex'; ui.clear(prev); M.loadImg(img, prev); }
    } });
    let out = null;
    const ok = async () => {
      const t = txt.value.trim();
      if (!t) { await ui.warn('必填欄位', '請輸入步驟說明。'); return; }
      out = { text: t, image: img }; m.close();
    };
    const m = ui.modal({ title, accent: 'var(--accent2)', width: 460, clickOut: false, onClose: () => res(out),
      body: h('div', h('div.fld-l', { style: { marginTop: '8px' } }, '步驟說明'), txt,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' } }, prev, st, h('span', { style: { flex: 1 } }),
          ui.btn('📷 選擇照片', 'muted', () => file.click()), file)),
      buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確  認', kind: 'blue', onclick: ok }] });
    setTimeout(() => txt.focus(), 40);
  });
  const nutDialog = (cur) => new Promise((res) => {
    const ins = {};
    const body = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 120px', gap: '6px 10px', alignItems: 'center', marginTop: '6px' } });
    for (const [k, label, unit] of NUT) {
      const v = cur[k];
      ins[k] = ui.input(v != null && v !== '' ? M.num(v) : '', { inputmode: 'decimal', style: { textAlign: 'right' } });
      body.appendChild(h('span.sub', `${label}（${unit}）`)); body.appendChild(ins[k]);
    }
    let out = null;
    const ok = async () => {
      const o = {};
      for (const [k, label] of NUT) {
        const t = ins[k].value.trim();
        if (!t) { o[k] = null; continue; }
        const v = Number(t);
        if (!isFinite(v)) { await ui.error('格式錯誤', `「${label}」必須是數字。`); return; }
        o[k] = v;
      }
      out = o; m.close();
    };
    const m = ui.modal({ title: '編輯營養成分', accent: 'var(--purple)', width: 380, body, clickOut: false, onClose: () => res(out),
      buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確  認', kind: 'blue', onclick: ok }] });
  });
})();
