import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.formatting.rule import CellIsRule, DataBarRule

T = json.load(open("/home/claude/budget/taxonomy.json"))
F = "Arial"
MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

hdr  = Font(name=F, bold=True, color="FFFFFF", size=10)
navy = PatternFill("solid", fgColor="1F3864")
band = PatternFill("solid", fgColor="D9E2F3")
yel  = PatternFill("solid", fgColor="FFFF00")
body = Font(name=F, size=10)
bold = Font(name=F, bold=True, size=10)
blue = Font(name=F, size=10, color="0000FF")
note = Font(name=F, size=9, italic=True, color="808080")
title= Font(name=F, bold=True, size=13, color="1F3864")
thin = Side(style="thin", color="BFBFBF")
box  = Border(top=thin,bottom=thin,left=thin,right=thin)
MONEY = '#,##0.00;(#,##0.00);-'

wb = Workbook()

# ═══ Transactions — what the app appends to ════════════════════════════════
tx = wb.active; tx.title = "Transactions"
TXCOLS = ["Row Key","Date","Time","Who","Amount","Currency","Category","Segment",
          "Note","Month","Year","Logged At"]
for i,(c,w) in enumerate(zip(TXCOLS,[26,12,8,10,12,9,18,26,24,8,8,22]),1):
    cell = tx.cell(1,i,c); cell.font = hdr; cell.fill = navy
    cell.alignment = Alignment(horizontal="center")
    tx.column_dimensions[L(i)].width = w
tx.freeze_panes = "A2"
ex = ["2026-08-27-Wassim-1756315500000-k3f9","2026-08-27","22:05","Wassim",245.50,
      "AED","Home Expenses","Food Delivery","Talabat","Aug",2026,"2026-08-27T18:05:00Z"]
for i,v in enumerate(ex,1): tx.cell(2,i,v).font = body
tx.cell(2,5).number_format = MONEY
tx.cell(3,1,"↑ one example row. Delete it once real entries arrive. The app appends below.").font = note

# ═══ Monthly — his layout, but the month columns fill themselves ═══════════
m = wb.create_sheet("Monthly")
m.column_dimensions["A"].width = 5
m.column_dimensions["B"].width = 18
m.column_dimensions["C"].width = 28
m.column_dimensions["D"].width = 15
for i in range(5,17): m.column_dimensions[L(i)].width = 11
m.column_dimensions["Q"].width = 13; m.column_dimensions["R"].width = 15

m.cell(1,1,"Year").font = bold
yc = m.cell(1,2,2026); yc.font = blue; yc.fill = yel; yc.number_format = "0"
m.cell(1,4,"← every month column below reads this year from Transactions").font = note

def block_header(r, label):
    m.cell(r,1,"Index").font = hdr; m.cell(r,1).fill = navy
    m.cell(r,2,"Category").font = hdr; m.cell(r,2).fill = navy
    m.cell(r,3,label).font = hdr; m.cell(r,3).fill = navy
    m.cell(r,4,"Monthly expected").font = hdr; m.cell(r,4).fill = navy
    for i,mo in enumerate(MONTHS):
        c = m.cell(r,5+i,mo); c.font = hdr; c.fill = navy
        c.alignment = Alignment(horizontal="center")
    m.cell(r,17,"Actual YTD").font = hdr; m.cell(r,17).fill = navy
    m.cell(r,18,"Expected / year").font = hdr; m.cell(r,18).fill = navy
    for i in range(1,19): m.cell(r,i).border = box

# summary block
block_header(2, "Summary")
sub_rows = {}
r = 3
summary_first = r
for idx,cat in enumerate(T["categories"], 1):
    m.cell(r,1,idx).font = body
    m.cell(r,2,"Jamela & Wassim").font = body
    m.cell(r,3,f"Total {cat['name']}").font = bold
    r += 1
summary_last = r-1
tot_row = r
m.cell(tot_row,3,"Total Expenses").font = bold

# category blocks
r = tot_row + 3
for cat in T["categories"]:
    block_header(r, cat["name"]); hdr_r = r; r += 1
    first = r
    for i,seg in enumerate(cat["segments"],1):
        m.cell(r,1,i).font = body
        m.cell(r,2,cat["name"]).font = body
        m.cell(r,3,seg).font = body
        b = m.cell(r,4, T["budgets"].get(f"{cat['name']}|{seg}", 0))
        b.font = blue; b.fill = yel; b.number_format = MONEY
        for j in range(12):
            col = 5+j
            f = (f'=SUMIFS(Transactions!$E:$E,'
                 f'Transactions!$G:$G,$B{r},'
                 f'Transactions!$H:$H,$C{r},'
                 f'Transactions!$J:$J,{L(col)}${hdr_r},'
                 f'Transactions!$K:$K,$B$1)')
            c = m.cell(r,col,f); c.font = body; c.number_format = MONEY
        m.cell(r,17,f"=SUM(E{r}:P{r})").font = body; m.cell(r,17).number_format = MONEY
        m.cell(r,18,f"=D{r}*12").font = body;        m.cell(r,18).number_format = MONEY
        r += 1
    last = r-1
    m.cell(r,3,f"Total {cat['name']}").font = bold
    for col in list(range(4,17))+[17,18]:
        c = m.cell(r,col,f"=SUM({L(col)}{first}:{L(col)}{last})")
        c.font = bold; c.number_format = MONEY; c.fill = band
    m.cell(r,3).fill = band; m.cell(r,1).fill = band; m.cell(r,2).fill = band
    sub_rows[cat["name"]] = r
    r += 3

# wire the summary to each block's subtotal
for i,cat in enumerate(T["categories"]):
    rr = summary_first + i
    sr = sub_rows[cat["name"]]
    for col in list(range(4,17))+[17,18]:
        c = m.cell(rr,col,f"={L(col)}{sr}")
        c.font = body; c.number_format = MONEY
for col in list(range(4,17))+[17,18]:
    c = m.cell(tot_row,col,f"=SUM({L(col)}{summary_first}:{L(col)}{summary_last})")
    c.font = bold; c.number_format = MONEY; c.fill = band
m.cell(tot_row,3).fill = band
m.freeze_panes = "E3"

# ═══ Budget vs Actual — the comparison, this month ════════════════════════
b = wb.create_sheet("Budget vs Actual")
b.column_dimensions["A"].width = 18; b.column_dimensions["B"].width = 28
for col,w in zip("CDEFG",[14,14,14,12,16]): b.column_dimensions[col].width = w
b.cell(1,1,"Budget vs Actual").font = title
b.cell(3,1,"Month").font = bold
mc = b.cell(3,2,"Aug"); mc.font = blue; mc.fill = yel
b.cell(3,3,"Year").font = bold
yc2 = b.cell(3,4,2026); yc2.font = blue; yc2.fill = yel; yc2.number_format="0"
b.cell(3,5,"← type any month").font = note

for i,h in enumerate(["Category","Segment","Budget","Spent","Left","Used","Status"],1):
    c = b.cell(5,i,h); c.font = hdr; c.fill = navy
    c.alignment = Alignment(horizontal="center"); c.border = box

r = 6
first_b = r
for cat in T["categories"]:
    for seg in cat["segments"]:
        b.cell(r,1,cat["name"]).font = body
        b.cell(r,2,seg).font = body
        b.cell(r,3,f'=SUMIFS(Monthly!$D:$D,Monthly!$B:$B,$A{r},Monthly!$C:$C,$B{r})').font=body
        b.cell(r,4,(f'=SUMIFS(Transactions!$E:$E,Transactions!$G:$G,$A{r},'
                    f'Transactions!$H:$H,$B{r},Transactions!$J:$J,$B$3,'
                    f'Transactions!$K:$K,$D$3)')).font=body
        b.cell(r,5,f"=C{r}-D{r}").font=body
        b.cell(r,6,f'=IFERROR(D{r}/C{r},0)').font=body
        b.cell(r,7,(f'=IF(C{r}=0,IF(D{r}>0,"No budget","—"),'
                    f'IF(D{r}>C{r},"OVER",IF(D{r}/C{r}>=0.9,"Close","OK")))')).font=body
        for col in (3,4,5): b.cell(r,col).number_format = MONEY
        b.cell(r,6).number_format = '0%'
        b.cell(r,7).alignment = Alignment(horizontal="center")
        r += 1
last_b = r-1
b.cell(r,2,"Total").font = bold
for col,f in [(3,f"=SUM(C{first_b}:C{last_b})"),(4,f"=SUM(D{first_b}:D{last_b})"),
              (5,f"=C{r}-D{r}"),(6,f"=IFERROR(D{r}/C{r},0)")]:
    c=b.cell(r,col,f); c.font=bold; c.fill=band
    c.number_format = '0%' if col==6 else MONEY
b.cell(r,1).fill = band; b.cell(r,2).fill = band; b.cell(r,7).fill = band
b.freeze_panes = "A6"

rng = f"G{first_b}:G{last_b}"
b.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"OVER"'],
    font=Font(name=F,bold=True,color="9C0006"), fill=PatternFill("solid",fgColor="FFC7CE")))
b.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"Close"'],
    font=Font(name=F,bold=True,color="9C5700"), fill=PatternFill("solid",fgColor="FFEB9C")))
b.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"OK"'],
    font=Font(name=F,color="006100"), fill=PatternFill("solid",fgColor="C6EFCE")))
b.conditional_formatting.add(f"F{first_b}:F{last_b}",
    DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="2A78D6"))

# ═══ Categories ═══════════════════════════════════════════════════════════
c = wb.create_sheet("Categories")
c.column_dimensions["A"].width=20; c.column_dimensions["B"].width=28; c.column_dimensions["C"].width=14
for i,h in enumerate(["Category","Segment","Monthly budget"],1):
    x=c.cell(1,i,h); x.font=hdr; x.fill=navy; x.alignment=Alignment(horizontal="center")
r=2
for cat in T["categories"]:
    for seg in cat["segments"]:
        c.cell(r,1,cat["name"]).font=body
        c.cell(r,2,seg).font=body
        c.cell(r,3,f"=SUMIFS(Monthly!$D:$D,Monthly!$B:$B,$A{r},Monthly!$C:$C,$B{r})").font=body
        c.cell(r,3).number_format = MONEY
        r+=1
c.freeze_panes="A2"
c.cell(1,5,"The app reads this tab, so its buttons always match your sheet.").font=note
c.cell(2,5,"Budgets are edited in Monthly (column D). This mirrors them.").font=note

# ═══ README ═══════════════════════════════════════════════════════════════
rd = wb.create_sheet("README"); wb.move_sheet("README", -(len(wb.sheetnames)-1))
rd.column_dimensions["A"].width=22; rd.column_dimensions["B"].width=94
for i,(a,t) in enumerate([
    ("Personal Budget",""),
    ("",""),
    ("Monthly","Your layout, unchanged — except the month columns now fill themselves from Transactions."),
    ("","Edit column D (yellow) to set each segment's monthly budget. Nothing else needs typing."),
    ("Budget vs Actual","Budget against this month's spending, per segment, with OVER / Close / OK."),
    ("Transactions","The log. The phone app appends here. You never type in it."),
    ("Categories","What the app shows as buttons, mirrored from Monthly."),
    ("",""),
    ("Yellow cells","The only ones you edit: the year, the month on Budget vs Actual, and the budgets."),
    ("Do not","Rename tabs, reorder columns, or insert rows above a header — the app matches on name."),
    ("",""),
    ("Where the numbers","Every month figure is a SUMIFS over Transactions matching Category, Segment,"),
    ("come from","Month and Year. Log something on the phone and this recalculates on its own."),
], start=1):
    rd.cell(i,1,a).font = title if i==1 else bold
    rd.cell(i,2,t).font = body

wb.save("/home/claude/budget/sheet/Personal-Budget-Live.xlsx")
print("workbook written")
