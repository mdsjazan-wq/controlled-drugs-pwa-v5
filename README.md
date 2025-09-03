# Controlled Drugs PWA — V5 (Gazan)

واجهة ويب خفيفة لاختبار عمليات برنامج الأدوية المخدرة (نسخة 5).

## الإعداد
1) ضع مفاتيح Supabase في `config.js` (موجودة بالفعل في هذه الحزمة وفق ما زودتني به).
2) ارفع سكربت قاعدة البيانات في `db/migrations/v4_002_warehouse_ops.sql` داخل Supabase SQL Editor.
3) شغّل الصفحة محليًا (يفضل Live Server) ثم سجّل الدخول بحساب يملك الدور `admin` أو `storekeeper`.

## الدوال المستخدمة
- `app_current_role()`
- `fn_warehouse_snapshot()`
- `fn_center_snapshot(p_center_id)`
- `rpc_wh_receive_supply(p_item_id,p_qty,p_happened_at)`
- `rpc_wh_issue_to_center(p_center_id,p_item_id,p_qty,p_happened_at)`
- `rpc_wh_receive_return_from_center(p_center_id,p_item_id,p_qty,p_status,p_happened_at)`
