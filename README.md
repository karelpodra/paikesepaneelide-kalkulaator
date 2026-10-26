# Testid

Harness käivitab kalkulaatori tegeliku `<script>` sisu minimaalse DOM-i jäljendis
(brauserit pole vaja) ja kontrollib:

1. vaikeseaded — ükski väljund ei tohi olla NaN / Infinity / undefined
2. kõik lülitite kombinatsioonid (2^4)
3. iga liugur min- ja max-asendis
4. iga rippmenüü iga valik koos change-käsitlejatega
5. äärmuslikud kombinatsioonid (null-tarbimine, pisike peakaitse + suur aku, …)
6. **energiabilansid** iga kuu ja päevatüübi kohta — tootmine, tarbimine ja aku
   sisend/väljund peavad klappima 0,01 kWh täpsusega — ning 1. aasta sääst peab
   võrduma sõltumatu tunnipõhise ümberarvutusega
7. ajamõõtmine

Käivitamine (repo juurkaustast, Node 18+):

    node test/harness.js

Väljub koodiga 1, kui midagi ebaõnnestub. `.github/workflows/test.yml` jooksutab
sama testi igal push'il ja pull request'il.
