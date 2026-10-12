# API Documentation for NCD Dashboard

## Table of Contents

1. [General Information](#general-information)
2. [Dropdown Filter](#dropdown-filter)
3. [Card Summary](#card-summary)
4. [Barchart](#barchart)
   - [Barchart Patient](#1-barchart-patient)
   - [Barchart Expense](#2-barchart-expense)
5. [Graph](#graph)
   - [All Disease Patient](#1-all-disease-patient)
   - [All Disease Expense](#2-all-disease-expense)
   - [DM Patient](#3-dm-patient)
   - [DM Expense](#4-dm-expense)
   - [CA Patient](#5-ca-patient)
   - [CA Expense](#6-ca-expense)

## General Information

### Request Parameters

| Parameter | Type   | Description  |
| --------- | ------ | ------------ |
| startDate | Date   | วันที่เริ่มต้น     |
| endDate   | Date   | วันที่สิ้นสุด      |
| hcode     | string | รหัสหน่วยบริการ |
| area      | string | เขตสุขภาพ     |
| province  | string | จังหวัด        |
| district  | string | อำเภอ        |

<!-- pagebreak -->

## Dropdown Filter

### 1. Dropdown Filter Information

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/dropdown-filter`

#### Request Body Example

```json
{
  "type": "hospital_code หาหน่วยบริการ || province หาจังหวัด || district หาอำเภอ ",
  "area": "",
  "province": "",
  "district": ""
}
```

#### Response Body Example

##### type Province

```json
{
  "status": true,
  "message": "success",
  "type": "จังหวัด"
  data: [
    {
        "น่าน",
        "พะเยา",
        "ลำปาง"
    }
  ]
}
```

##### type district

```json
{
  "status": true,
  "message": "success",
  "type": "อำเภอ"
  data: [
    {
        "กงหรา",
        "กงไกรลาศ",
        "กบินทร์บุรี",
        "กมลาไสย",
    }
  ]
}
```

##### type hospital_code

```json
{
  "status": true,
  "message": "success",
  "type": "หน่วยบริการ"
  data: [
    {
       {
            "hcode": "00037",
            "hname": "สำนักงานสาธารณสุขจังหวัดเชียงใหม่",
            "full_text": "00037 : สำนักงานสาธารณสุขจังหวัดเชียงใหม่"
        },
        {
            "hcode": "00529",
            "hname": "สำนักงานสาธารณสุขอำเภอเมืองเชียงใหม่",
            "full_text": "00529 : สำนักงานสาธารณสุขอำเภอเมืองเชียงใหม่"
        },
        {
            "hcode": "00530",
            "hname": "สำนักงานสาธารณสุขอำเภอจอมทอง",
            "full_text": "00530 : สำนักงานสาธารณสุขอำเภอจอมทอง"
        },
    }
  ]
}
```

### 2. Dropdown Filter Fiscal year

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/dropdown-fiscal-year`

#### Request Method GET

<!-- ##### Method GET -->

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "data": [2024, 2025]
}
```

### 3. Date Update Data

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/date-update`

#### Request Method GET

<!-- ##### Method GET -->

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "date": "2024-11-18T08:46:55.673Z",
  "date_format": "18/11/2024 03:46 PM"
}
```

### 4. Get Health Office Detail

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/get_health_office_detail`

#### Request Body Example

```json
{
  "province": "",
  "hospital_code": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "data": {
    "hname": "โรงพยาบาลพล",
    "province": "ขอนแก่น",
    "district": "พล",
    "hcode": "11004",
    "area": "07"
  }
}
```

## Card Summary

### 1. Card Summary Information

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/card`

#### Request Body Example

```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "service_count": 207710,
      "expense": "410876628.63",
      "hcode_count": 1063,
      "patient_count": 16495,
      "avg_service": "12.59",
      "avg_expense": "24909.16"
    }
  ]
}
```

## Barchart

### 1. Barchart Patient

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/bar-chart-pt`

#### Request Body Example

```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "โรคเบาหวาน",
      "qtyOfPatient": 10630,
      "avg": "12.47"
    },
    {
      "diseaseName": "โรคความดันโลหิตสูง",
      "qtyOfPatient": 26,
      "avg": "1193.81"
    },
    {
      "diseaseName": "โรคปอดอุดกั้นเรื้อรัง",
      "qtyOfPatient": 2815,
      "avg": "1.98"
    },
    {
      "diseaseName": "โรคมะเร็ง",
      "qtyOfPatient": 1158,
      "avg": "3.02"
    },
    {
      "diseaseName": "สุขภาพจิต",
      "qtyOfPatient": 58,
      "avg": "6.74"
    },
    {
      "diseaseName": "โรคหัวใจและหลอดเลือด",
      "qtyOfPatient": 1821,
      "avg": "18.28"
    }
  ]
}
```

### 2. Barchart Expense

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/bar-chart-ex`

#### Request Body Example

```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "โรคเบาหวาน",
      "qtyOfExpense": "216032165.72",
      "avg": "20320.96"
    },
    {
      "diseaseName": "โรคความดันโลหิตสูง",
      "qtyOfExpense": "41823216.44",
      "avg": "1608585.25"
    },
    {
      "diseaseName": "โรคปอดอุดกั้นเรื้อรัง",
      "qtyOfExpense": "40983836.19",
      "avg": "14543.59"
    },
    {
      "diseaseName": "โรคมะเร็ง",
      "qtyOfExpense": "59038588.85",
      "avg": "50983.24"
    },
    {
      "diseaseName": "สุขภาพจิต",
      "qtyOfExpense": "1915575.96",
      "avg": "33027.17"
    },
    {
      "diseaseName": "โรคหัวใจและหลอดเลือด",
      "qtyOfExpense": "51060045.48",
      "avg": "28024.17"
    }
  ]
}
```

## Graph

### 1. All Disease Patient

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/graph-disease-pt`

#### Request Body Example

```json
{
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "ทั้งหมด",
      "data": [30, 55, 122, 1291, 8212, 4109, 2793, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคเบาหวาน",
      "data": [13, 18, 33, 998, 5512, 2327, 1779, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคความดันโลหิตสูง",
      "data": [2, 1, 1, 1, 15, 8, 5, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคปอดอุดกั้นเรื้อรัง",
      "data": [6, 12, 34, 169, 1311, 867, 468, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคมะเร็ง",
      "data": [9, 19, 27, 61, 577, 320, 165, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "สุขภาพจิต",
      "data": [1, 3, 2, 5, 20, 23, 10, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคหัวใจและหลอดเลือด",
      "data": [4, 8, 31, 62, 786, 570, 372, 1, 0, 0, 1, 0]
    }
  ]
}
```

### 2. All Disease Expense

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/graph-disease-ex`

#### Request Body Example

```json
{
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "ทั้งหมด",
      "data": [
        "137039.09",
        "641501.75",
        "1072833.20",
        "32384657.78",
        "209313764.34",
        "101236172.50",
        "63843414.48",
        "23200.00",
        "0.00",
        "0.00",
        "1471.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคเบาหวาน",
      "data": [
        "19092.84",
        "158041.25",
        "160686.95",
        "24245014.98",
        "114635351.10",
        "44566476.85",
        "31823869.75",
        "0.00",
        "0.00",
        "0.00",
        "1471.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคความดันโลหิตสูง",
      "data": [
        "10929.25",
        "31129.25",
        "156520.10",
        "2614464.41",
        "19856340.44",
        "11860981.51",
        "7046481.73",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคปอดอุดกั้นเรื้อรัง",
      "data": [
        "15799.50",
        "121309.00",
        "159367.25",
        "1068888.53",
        "21317758.50",
        "10998492.86",
        "7025284.80",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคมะเร็ง",
      "data": [
        "80005.00",
        "300760.00",
        "363681.80",
        "1159488.59",
        "28216499.39",
        "18271428.12",
        "9681168.70",
        "23200.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "สุขภาพจิต",
      "data": [
        "0.00",
        "2568.00",
        "7886.00",
        "66502.90",
        "844057.52",
        "715340.07",
        "255699.47",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคหัวใจและหลอดเลือด",
      "data": [
        "11212.50",
        "27694.25",
        "224691.10",
        "3230298.37",
        "24443757.39",
        "14823453.09",
        "8010910.03",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    }
  ]
}
```

### 3. DM Patient

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/graph-dm-pt`

#### Request Body Example

```json
{
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
      "data": [1, 1, 1, 1, 2, 1, 1, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
      "data": [1, 1, 1, 1, 1, 2, 1, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "เบาหวานชนิดอื่น ๆ",
      "data": [12, 17, 32, 997, 5510, 2325, 1778, 0, 0, 0, 0, 0]
    }
  ]
}
```

### 4. DM Expense

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/graph-dm-ex`

#### Request Body Example

```json
{
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
      "data": [
        "4569.75",
        "0.00",
        "0.00",
        "454366.65",
        "4430034.78",
        "2033362.58",
        "1158945.52",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
      "data": [
        "615.00",
        "6710.75",
        "2427.90",
        "120341.80",
        "3528505.95",
        "886916.89",
        "1355038.20",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
      "data": ["0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]
    },
    {
      "diseaseName": "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
      "data": ["0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]
    },
    {
      "diseaseName": "เบาหวานชนิดอื่น ๆ",
      "data": [
        "13908.09",
        "151330.50",
        "158259.05",
        "23670306.53",
        "106676810.37",
        "41646197.38",
        "29309886.03",
        "0.00",
        "0.00",
        "0.00",
        "1471.00",
        "0.00"
      ]
    }
  ]
}
```

### 5. CA Patient

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/graph-ca-pt`

#### Request Body Example

```json
{
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "โรคมะเร็งปอด",
      "data": [3, 2, 4, 2, 19, 17, 9, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคมะเร็งเต้านม",
      "data": [5, 9, 6, 30, 169, 192, 49, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคมะเร็งปากมดลูก",
      "data": [2, 2, 3, 3, 26, 19, 7, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคมะเร็งตับ",
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคมะเร็งลำไส้ใหญ่",
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0]
    },
    {
      "diseaseName": "โรคมะเร็งชนิดอื่น ๆ",
      "data": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  ]
}
```

### 6. CA Expense

**Endpoint:** `https://uat-fdh-dashboard.one.th/ncds_api/api/v1/graph-ca-ex`

#### Request Body Example

```json
{
  "area": "",
  "province": "",
  "district": "",
  "hcode": ""
}
```

#### Response Body Example

```json
{
  "status": true,
  "message": "success",
  "result": [
    {
      "diseaseName": "โรคมะเร็งปอด",
      "data": [
        "7790.00",
        "20556.75",
        "21400.00",
        "379699.65",
        "2014562.45",
        "2239753.52",
        "809652.42",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคมะเร็งเต้านม",
      "data": [
        "4999.50",
        "159761.75",
        "5557.50",
        "209689.50",
        "2825460.65",
        "2747331.14",
        "808292.69",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคมะเร็งปากมดลูก",
      "data": [
        "1177.00",
        "11562.00",
        "4031.00",
        "28173.00",
        "1048080.55",
        "865169.00",
        "112467.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    },
    {
      "diseaseName": "โรคมะเร็งตับ",
      "data": ["0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]
    },
    {
      "diseaseName": "โรคมะเร็งลำไส้ใหญ่",
      "data": ["0.00", "0.00", "0.00", "0.00", "0.00", "180.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]
    },
    {
      "diseaseName": "โรคมะเร็งชนิดอื่น ๆ",
      "data": [
        "66038.50",
        "108879.50",
        "332693.30",
        "541926.44",
        "22328395.74",
        "12418994.46",
        "7950756.59",
        "23200.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00"
      ]
    }
  ]
}
```
