# PROSPERO Protocol Template 撰寫指引

本指引搭配 [`templates/PROSPERO_PROTOCOL_TEMPLATE.md`](../templates/PROSPERO_PROTOCOL_TEMPLATE.md) 使用。Template 使用英文欄位名稱並與本專案實測的 PROSPERO Intervention registration 12 區段、39 欄完全對齊。

> 重要：PROSPERO registration 是 protocol 的摘要紀錄，不等於完整 protocol。正式 protocol 建議同時依 PRISMA-P 撰寫。PROSPERO 欄位仍須逐欄完成，提供 protocol 檔案不能取代 registration answers。

## 1. 使用順序

1. 複製空白 template，另存為你的研究檔案。
2. 保留所有英文 headings，不要改名，將英文答案寫在 heading 下方。
   Eligibility 欄位請在答案內使用 `Included: ...` 與 `Excluded: ...`，不要新增 Markdown 子標題，以維持自動欄位映射。
3. 不確定的內容寫成 `[TO CONFIRM: ...]`，不要讓 AI自行補方法或聲明。
4. 執行 `prospero_protocol_to_registration`，產生 workbook、validation 與 similar-review report。
5. 修正 `missing information`、字數及一致性問題。
6. 由 guarantor、方法學人員及所有相關作者確認。
7. 人工貼入 PROSPERO，逐欄檢查後再決定是否 Mark as complete／Submit；本工具不執行最終提交。

PROSPERO 官方說明允許從 protocol 剪貼到表單，但 required fields 仍須個別完成；registration 內容由團隊負責其正確性。參考：[PROSPERO registration guidance](https://www.crd.york.ac.uk/prospero/documents/Registering%20a%20review%20on%20PROSPERO.pdf)、[PROSPERO FAQ](https://www.crd.york.ac.uk/PROSPERO/faq)。完整 protocol 可依 [PRISMA-P checklist](https://www.prisma-statement.org/protocols) 檢查。

## 2. 寫作原則

- 使用英文，採未來式描述尚未執行的方法，例如 `Two reviewers will independently screen...`。
- 只寫團隊已預先決定的方法。不要把 `may`, `consider` 或 AI建議改寫成確定承諾。
- Eligibility、outcomes、search、risk of bias 與 synthesis 必須互相一致。
- 精確區分 screening test、diagnostic test、prediction model、prognostic factor、intervention 與 exposure。
- 縮寫第一次出現時先寫全名。
- 日期使用不含糊的完整格式，例如 `1 September 2026`。
- 工具、資料庫及方法寫正式名稱與版本；版本未確定時明確標示待確認。
- 不要宣稱 PROSPERO 已 peer review protocol；PROSPERO 公開紀錄不代表方法獲得背書。

## 3. 自動化可信度

| 等級 | 可採取的動作 | 典型欄位 |
|---|---|---|
| High | protocol 原文抽取、縮排、字數檢查後快速確認 | Objectives、PICO、study design、outcomes、databases、screening、extraction、RoB、synthesis |
| Medium | 可產生濃縮草稿，但需逐句確認沒有新增承諾 | Rationale、context、keywords、additional information |
| Manual | 只能整理資料，不得代替本人或團隊判斷 | Similar reviews、timeline、review stage、team、funding、peer review、COI、公開連結 |

每個自動產生答案都應保留：`proposed answer`、`source section`、`confidence`、`word count` 與 `missing information`。

## 4. 39 欄逐欄指引

下列 required 與字數限制來自 2026-07-16 擷取的 PROSPERO 2.0.39 Intervention template。網站更新或 review type 不同時，以 `prospero_get_registration_schema` 的即時結果為準。`—` 表示頁面沒有顯示文字字數限制，仍可能有必選控制項。

### REVIEW TITLE AND BASIC DETAILS

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Review title | Yes；5–30 | Population、核心 intervention/exposure、目的及 review type；避免只寫寬泛疾病名 | High，最後人工確認 |
| Review type | No；— | 選擇 intervention、diagnostic、prognostic、etiologic、qualitative、methodological 等最符合者 | Manual |
| Condition or domain being studied | Yes；1–200 | 疾病、健康領域、疾病階段及必要的臨床範圍 | High |
| Rationale for the review | Yes；5–250 | 現有證據、明確缺口、為何現在需要、與既有 review 的差異及預期用途 | Medium |
| Review objectives | Yes；10–200 | 一個主要 objective；需要時列次要 objectives，並與 PICO/outcomes 一致 | High |
| Keywords | Yes；— | Condition、population、intervention/exposure、outcome、review method 的自由文字詞 | Medium |
| Country | Yes；— | Review 團隊或 review 所屬國家；依網站選項確認 | Manual confirm |

### ELIGIBILITY CRITERIA

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Population | Yes；5–200 | Included/Excluded 分開；年齡、診斷標準、疾病階段、setting 及混合族群處理 | High |
| Intervention(s) or exposure(s) | Yes；≤200 | 明確定義介入、測試或暴露；列同義詞、劑量/強度/時點及排除範圍 | High |
| Comparator(s) or control(s) | No；— | Eligible comparators；若無 comparator，明確說明 | High |
| Study design | Yes；≤250 | 納入/排除設計、prospective/retrospective、RCT/observational/qualitative 等 | High |
| Context | Yes；5–250 | Care setting、地區、health system、publication years 等無法放入其他 PICO 欄的範圍 | Medium |

不要把 outcome 放入 population，也不要以「全文可取得」作為科學性納入標準，除非有合理且事先定義的理由。

### SIMILAR REVIEWS

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Check for similar records already in PROSPERO | Yes；— | 列出 PROSPERO ID、PubMed review、重疊處、實質差異及仍進行的理由 | Search/compare 自動；結論 Manual |

先搜尋 PROSPERO 的 ongoing、completed、discontinued records，再以 PubMed 補充已發表 reviews。比較 Population、Intervention、Comparator、Outcomes、study design、search dates 與 synthesis。PROSPERO 支援 Boolean、phrases、wildcards、proximity、field codes 與 MeSH；參考 [PROSPERO search help](https://www.crd.york.ac.uk/PROSPERO/search)。

可以繼續的合理差異可能包括：不同 population、不同 intervention/comparator、較新 search period、不同 outcome、改良的方法或不同 synthesis。不能只寫 `not similar`；應具體說明差異。若高度相似，應由團隊判斷更新價值，必要時聯絡既有 review contact。

### TIMELINE AND FULL PROTOCOL

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Review timeline | Yes；— | 真實 start date、預計 end date、是否 living review | Manual |
| Availability of full protocol | Yes；— | 是否已完成、公開 URL/DOI、將上傳 PDF、僅可索取或尚未撰寫 | Manual |

日期必須符合實際進度；不要為了通過 eligibility 而回填不實日期。公開 protocol 更新時保留版本與 amendment history。

### SEARCHING AND SCREENING

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Search for unpublished studies | Yes；— | 是否納入 unpublished/grey literature；與來源清單一致 | High + confirm |
| Main sources that will be searched | Yes；— | 每個 database/platform，例如 MEDLINE via Ovid、Embase via Ovid、CENTRAL | High |
| Search language restrictions | Yes；— | 無限制或具體語言及理由 | High + confirm |
| Search date restrictions | Yes；— | 起訖日期或無起始限制；說明最後搜尋與更新計畫 | High + confirm |
| Other methods of identifying studies | No；≤50 | Backward/forward citation、trial registries、conference proceedings、contact authors | High |
| Link to search strategy | Yes；— | 公開 URL、protocol appendix 或上傳 PDF；至少提供一個完整可重現策略 | Manual link |
| Selection process | Yes；— | 幾位 reviewer、獨立性、title/abstract 與 full-text 階段、衝突解決 | High |
| Other relevant information about searching and screening | No；≤250 | Deduplication、software、automation tools、machine assistance 及人工覆核 | High |

完整搜尋策略至少應包含 database/platform、controlled vocabulary、free-text synonyms、Boolean/proximity、limits、search date 及完整可重現字串。

### DATA COLLECTION PROCESS

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Data extraction from published articles and reports | Yes；— | Extraction form、雙人獨立/核對、衝突解決、聯絡作者、抽取資料項目 | High |
| Study risk of bias or quality assessment | Yes；— | 與 study design 相符的工具、reviewers、衝突解決及 domain-level judgment | High + method confirm |
| Reporting bias assessment | Yes；— | Missing results/publication bias 的評估方法；不評估時說明 | High + method confirm |
| Certainty assessment | Yes；— | GRADE、GRADE-CERQual 或其他框架；不評估時明確說明 | High + method confirm |

工具必須匹配設計，例如 RCT、non-randomized intervention、diagnostic accuracy、prediction model 或 qualitative study 不應共用不適合的 appraisal tool。

### OUTCOMES AND SYNTHESIS

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Main outcomes | Yes；5–250 | Outcome 定義、measurement instrument、time point、effect measure 及優先順序 | High |
| Additional outcomes | No；≤300 | 次要 outcomes、harms、process/patient-reported outcomes，同樣明確定義 | High |
| Strategy for data synthesis | Yes；— | Narrative/meta-analysis、effect measure、model、heterogeneity、missing data、software、subgroup/sensitivity、何時不合併 | High + method confirm |

不要只列 outcome 名稱。例：除了 `overall survival`，還應寫起算點、event、time point 與預計 effect measure。Synthesis 不應承諾 protocol 未決定的 network meta-analysis、Bayesian model 或 subgroup。

### CURRENT REVIEW STAGE

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Stage of the review at this submission | Yes；— | Pilot、search、screening、extraction、RoB、synthesis 各自 Started/Completed 的真實狀態 | Manual |
| Publication of review results | Yes；— | 預計發表語言與 dissemination plan | Manual confirm |

這是時效性資料，不能只從舊 protocol 推斷。每次提交或 amendment 前重新確認。

### AFFILIATION, FUNDING AND PEER REVIEW

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Review team members | Yes；— | 姓名、角色、email、ORCID、機構、國家、guarantor/contact；由本人確認 | Manual |
| Review affiliation | Yes；1–20 | 主要 institution/organisation 正式名稱 | Manual confirm |
| Funding source | Yes；≤50 | Funder、grant number、support 性質、funder role；無 funding 時明確聲明 | Manual |
| Peer review | Yes；— | 是否 peer reviewed、由誰/何種程序、範圍及修改情況 | Manual |

不要把 supervisor 看過、共同作者討論或 PROSPERO registration 誤稱為 independent peer review。作者及 affiliation 應使用公開後可接受的正式資料。

### ADDITIONAL INFORMATION

| 欄位 | Required／Words | 撰寫內容 | 自動化 |
|---|---|---|---|
| Additional information | No；≤250 | Linked records、特殊方法、amendment/version plan、其他欄位未涵蓋事項 | Medium |
| Review conflict of interest | Yes；— | Financial、professional、academic、personal interests；無則明確聲明 | Manual declaration |
| Medical Subject Headings | No；— | 正式 MeSH descriptors，不要只複製自由文字 keywords | Medium + confirm |

COI 必須由相關人員確認，AI不得代替本人作聲明。MeSH 應優先使用 NLM 正式 descriptor，並與 condition/PICO 一致。

## 5. Similar-review difference rationale 格式

```text
The proposed review overlaps with [record/citation] in [shared scope].
However, it differs in [population/intervention/comparator/outcome/design/search dates/synthesis].
The existing review searched up to [date/status], whereas the proposed review will [specific update or method].
The review team therefore considers the new review justified because [concrete reason].
```

如果無法從 title/abstract/record 判斷，寫 `Unable to determine from the indexed record`，不要推測。

## 6. 最終一致性檢查

- [ ] Title、objectives、PICO、eligibility、outcomes 及 synthesis 回答同一問題。
- [ ] Review type 與納入設計、risk-of-bias tool、synthesis 相容。
- [ ] 每個 main outcome 有定義、time point、measurement/effect measure。
- [ ] Search sources 與完整策略一致，且可重現。
- [ ] Language/date/grey-literature restrictions 有清楚理由。
- [ ] Screening、extraction 及 appraisal 的 reviewer 數量和衝突解決一致。
- [ ] Similar reviews 已同時檢查 PROSPERO 與已發表 reviews，差異理由具體。
- [ ] Timeline 與 review stage 是提交當天的真實狀態。
- [ ] Team、funding、peer review、COI 已由相關人員確認。
- [ ] Protocol/search-strategy URL 可正常存取，版本日期正確。
- [ ] 所有 `[TO CONFIRM]` 已處理。
- [ ] Guarantor 已預覽完整 PROSPERO record。

## 7. 建議保留的研究檔案

- 完整 protocol 與版本紀錄
- PRISMA-P checklist
- 各 database 完整搜尋策略與執行日期
- Similar-review search log 與差異比較表
- Screening/extraction/RoB forms
- Statistical analysis plan
- Amendment/deviation log
- Team、funding、peer-review、COI confirmation

這些檔案可支持日後 amendment、manuscript 撰寫及 protocol-to-publication consistency review。
