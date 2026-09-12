# Leal Bets — especificación para la versión definitiva

Este documento resume toda la lógica que ya está probada y funcionando en el
prototipo (hecho como página HTML suelta), para que al programarlo en serio
(con backend y base de datos propia) no se pierda nada de lo que ya se armó.

## 1. Qué es

Una casa de apuestas con fichas virtuales para un grupo de amigos, sobre un
torneo amateur de fútbol (Copa del Rey, Primera A). Un equipo (Leal FC) tiene
además mercados de apuesta por jugador.

## 2. Modelo de datos

**Equipos**
```
{ id, name, rating }        // rating tipo Elo, arranca en 1500
```

**Partidos**
```
{
  id, homeId, awayId, homeName, awayName,
  odds: {
    home, draw, away,
    dc: { oneX, oneTwo, xTwo },              // doble oportunidad
    goals: { line: 2.5, over, under, expectedTotal },
    btts: { yes, no }                         // ambos equipos anotan
  },
  playerProps,        // solo presente si es partido de Leal FC (ver sección 4)
  status,             // 'upcoming' | 'finished'
  result: { outcome, homeGoals, awayGoals, totalGoals, playerStats },
  createdAt
}
```

**Usuarios**
```
{ [nombre]: { balance, password } }
```

**Apuestas (soportan combinadas/parlay)**
```
{
  id, user, stake, combinedOdds,
  legs: [ { matchId, pick, oddsAtBet, result } ],  // result: null | true | false
  settled, won, placedAt
}
```

**Historial de jugadores** (para las cuotas dinámicas, ver sección 4)
```
{ [nombreJugador]: [ { atajadas, faltas, remates, remates_arco, gol, asistencia, amarilla, roja }, ... ] }
```

## 3. Motor de cuotas de equipo

- Rating Elo por equipo, arranca en 1500 (o calculado desde la tabla de
  posiciones real: `1500 + (puntos - promedio_puntos)*25 + diferencia_de_gol*10`).
- Ventaja de local: +60 puntos de rating al calcular la probabilidad esperada.
- Fórmula Elo estándar: `P(gana local) = 1 / (1 + 10^((rating_visitante - (rating_local+60))/400))`.
- Probabilidad de empate: sube cuando los equipos están parejos (`0.22 + paridad*0.14`).
- Margen de la casa (overround): 8% sobre las cuotas justas.
- Doble oportunidad = combinar las probabilidades del 1x2 (ej. 1X = P(local)+P(empate)).
- Goles (más/menos de 2.5) y ambos anotan: se modelan con una distribución de
  Poisson. El gol total esperado sale de `2.6 + (suma_de_ratings - 3000)/500`
  (acotado entre 1.4 y 4.6). Para "ambos anotan" ese total se reparte entre
  ambos equipos según quién es más favorito, y se calcula la probabilidad de
  que cada uno anote al menos 1 (Poisson independiente por equipo).
- Al cargar el resultado de un partido, el rating de ambos equipos se
  actualiza con la fórmula de Elo (K=24), para que las cuotas de los
  próximos partidos reflejen el nivel real.

## 4. Motor de cuotas de jugador (props, solo para Leal FC)

Cada jugador tiene mercados de dos tipos:
- **Por umbral** ("2+ remates", "1+ falta cometida"): se paga si el jugador
  llega o supera esa cantidad en el partido. Cada umbral se trata como un
  mercado independiente (no se intenta ajustar una única distribución de
  probabilidad que explique todos los umbrales a la vez — probarlo así
  daba cuotas sin sentido en los umbrales más altos, porque las cuotas
  cargadas a mano no siguen necesariamente una curva matemática perfecta).
- **Binarios** (gol, asistencia, amarilla, roja): se paga si ocurre al menos
  una vez.

La lista de cuotas que se carga manualmente al principio funciona como una
**creencia previa** (prior) para cada mercado, por separado. A partir de ahí:
1. Se convierte la cuota previa de cada mercado (cada umbral, cada binario)
   en una probabilidad implícita: `p_previa = 1 / (cuota × 1.08)`.
2. Cada partido real jugado se agrega al historial del jugador (salvo que se
   marque "no jugó").
3. Antes de cada partido nuevo, para cada umbral se cuenta en cuántos
   partidos del historial el jugador llegó o superó ese umbral (`aciertos`),
   y se combina con la creencia previa:
   `p_final = (p_previa × 3 + aciertos) / (3 + partidos_jugados)`.
   El "3" es el peso que tiene la lista inicial (equivale a 3 partidos
   virtuales); a medida que hay más partidos reales, el historial real pesa
   cada vez más y la lista inicial se va diluyendo.
4. Para los mercados binarios es la misma fórmula, contando aciertos
   (gol/asistencia/amarilla/roja) en vez de "llegó al umbral".
5. Las cuotas finales vuelven a salir de esas probabilidades con el mismo
   margen del 8%: `cuota = 1 / (p_final × 1.08)`.

**Importante:** con cero partidos jugados, esta fórmula reproduce
exactamente la lista cargada a mano (es la propiedad que hay que preservar
si se reimplementa distinto: sin historial, cuota nueva = cuota original).

Esto se recalcula automáticamente cada vez que se programa un partido nuevo
de Leal FC o se carga un resultado.

## 5. Apuestas combinadas (parlay)

- Se puede combinar cualquier cantidad de selecciones, de cualquier partido
  o mercado, **incluyendo más de una selección del mismo partido**.
- La cuota final de la combinada es el producto de las cuotas de cada
  selección elegida en el momento de apostar (quedan "congeladas": si
  después cambian, no afecta a la apuesta ya hecha).
- Liquidación: cada selección (leg) se resuelve cuando termina su partido.
  Si una sola selección pierde, toda la combinada se da por perdida en el
  momento (no hace falta esperar a las demás). Si todas terminan ganando,
  se paga `monto apostado × cuota combinada`.
- **Selección anulada por "no jugó"**: si un jugador de LEAL sobre el que
  había una apuesta termina marcado como "no jugó este partido", esa
  selección puntual queda anulada (no cuenta a favor ni en contra). Si era
  la única selección de la apuesta, se devuelve el monto apostado completo
  (ni gana ni pierde). Si era parte de una combinada con otras selecciones,
  esas otras selecciones siguen su curso normal y, si termina ganando, el
  pago se recalcula con una "cuota efectiva" que es el producto de las
  cuotas de las selecciones que quedaron activas (se excluye del cálculo la
  cuota de la selección anulada).
- **Cerrar apuesta (cash out simple)**: mientras una apuesta sigue
  pendiente (no se resolvió ninguna de sus selecciones), el usuario puede
  cerrarla desde "Mis apuestas" y se le devuelve exactamente el monto que
  apostó (ni gana ni pierde). Una vez cerrada, esa apuesta queda marcada
  como cancelada y se excluye de cualquier liquidación futura, incluso si
  después se reabre un partido relacionado.

## 6. Cuentas de usuario

- Usuario + contraseña. La primera vez que alguien entra con un nombre
  nuevo, se crea la cuenta con el saldo inicial. Si el nombre ya existe, hay
  que poner la contraseña correcta para entrar a esa cuenta.
- **En este prototipo la contraseña se guarda en texto plano** — en la
  versión real hay que guardar un hash (bcrypt o similar), nunca la
  contraseña posta.
- No hay recuperación de contraseña olvidada; en la versión real conviene
  sumar un mail o alguna forma de resetear.

## 7. Acceso de administrador

- Una contraseña separada (fija en el código del prototipo) desbloquea la
  gestión de equipos, partidos y carga de resultados.
- En la versión real, mejor tener roles de usuario reales (una tabla de
  permisos), no una contraseña compartida.

## 8. Sincronización entre dispositivos

- El prototipo actual no tiene backend propio: guarda todo en un
  almacenamiento compartido ligado al link, y cada celular vuelve a leer
  ese almacenamiento cada 7 segundos (polling) para verse actualizado.
- En la versión real conviene una base de datos real (Postgres, Firebase,
  Supabase, etc.) con actualizaciones en tiempo real (WebSockets o
  suscripciones tipo Supabase Realtime/Firestore), para que sea instantáneo
  y no dependa de refrescos periódicos.

## 9. Otras cosas a tener en cuenta

- Los umbrales y las cuotas iniciales de cada jugador de Leal están
  hardcodeados en el código del prototipo. En la versión real, esto debería
  cargarse desde una pantalla de admin, no requerir tocar código cada
  semana.
- El sistema de rating (Elo + Poisson) es una aproximación simple pensada
  para un torneo amistoso, no un modelo estadístico profesional — funciona
  bien para esta escala, pero no hay que esperar precisión de casa de
  apuestas real.
- Falta cualquier tipo de historial/estadísticas visibles para el usuario
  más allá de "mis apuestas" (por ejemplo, un gráfico de evolución de
  fichas, o estadísticas acumuladas de cada jugador visibles en la app).
- No hay backup automático de los datos fuera del propio almacenamiento.

## 10. Funcionalidades que tiene que tener sí o sí la versión nueva

- Cuotas automáticas de equipo (1x2, doble oportunidad, goles, ambos anotan).
- Cuotas de jugador dinámicas para Leal FC, basadas en historial real.
- Apuestas combinadas con cualquier cantidad de selecciones, incluidas
  varias del mismo partido.
- Tabla de posiciones de apostadores (ranking de fichas).
- Historial de apuestas por usuario.
- Usuario y contraseña por jugador.
- Panel de administrador separado y protegido, para cargar equipos,
  partidos, resultados y estadísticas de jugadores.
- Actualización en tiempo real entre todos los dispositivos conectados.


---

# Código fuente completo del prototipo (leal-bets.html)

Este es el archivo completo, tal cual, para que Claude Code tenga la implementación de referencia de todo lo descripto arriba (fórmulas, liquidación, UI). La consigna es programar el mismo comportamiento con backend y base de datos propia, reemplazando el uso de `window.storage` (que es una API exclusiva de los artifacts de Claude.ai) por la base de datos real.

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Leal Bets</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --pitch: #0F3D2E;
    --pitch-deep: #0A2C21;
    --pitch-light: #1B5E42;
    --line: rgba(242,239,230,0.18);
    --chalk: #F2EFE6;
    --chalk-dim: #C9C4B4;
    --gold: #E3B23C;
    --gold-dim: #A9822B;
    --ink: #14201B;
    --red: #C1443B;
    --green-win: #4C9A6A;
  }
  *{box-sizing:border-box;}
  body{
    margin:0;
    background:var(--pitch-deep);
    color:var(--chalk);
    font-family:'Work Sans', sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:640px;margin:0 auto;padding:0 0 100px;}

  header.board{
    background:
      repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 2px, transparent 2px 40px),
      linear-gradient(180deg, var(--pitch) 0%, var(--pitch-deep) 100%);
    border-bottom:3px solid var(--gold);
    padding:20px 20px 18px;
  }
  .board-top{display:flex;justify-content:space-between;align-items:center;gap:12px;}
  .board-id{display:flex;align-items:center;gap:12px;}
  .tourney-shield{
    width:42px;height:42px;flex:none;
    clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);
    background:linear-gradient(160deg, var(--pitch-light), var(--pitch));
    border:1px solid var(--gold-dim);
    display:flex;align-items:center;justify-content:center;
    font-family:'Oswald', sans-serif;font-weight:700;font-size:13px;color:var(--gold);
  }
  h1{
    font-family:'Oswald', sans-serif;
    font-weight:600;
    font-size:20px;
    letter-spacing:0.2px;
    margin:0;
    color:var(--chalk);
  }
  .subtitle{color:var(--chalk-dim);font-size:12px;margin-top:3px;}
  .player-box{
    text-align:right;
    font-family:'Oswald', sans-serif;
  }
  .player-name{font-size:14px;color:var(--chalk-dim);}
  .chip-count{font-size:24px;color:var(--gold);font-weight:600;line-height:1.1;}
  .chip-count span{font-size:13px;color:var(--chalk-dim);font-family:'Work Sans',sans-serif;font-weight:400;}
  .switch-player{
    background:none;border:none;color:var(--chalk-dim);
    font-size:11px;text-decoration:underline;cursor:pointer;padding:4px 0 0;
    font-family:'Work Sans',sans-serif;
  }

  nav.tabs{
    display:flex;
    border-bottom:1px solid var(--line);
    background:var(--pitch);
    position:sticky;top:0;z-index:5;
  }
  nav.tabs button{
    flex:1;
    background:none;border:none;
    color:var(--chalk-dim);
    font-family:'Oswald', sans-serif;
    font-size:13px;
    letter-spacing:0.3px;
    padding:13px 4px;
    cursor:pointer;
    border-bottom:3px solid transparent;
  }
  nav.tabs button.active{color:var(--chalk);border-bottom-color:var(--gold);}

  main{padding:18px 16px 0;}
  section{display:none;}
  section.active{display:block;}

  .empty{
    text-align:center;color:var(--chalk-dim);
    font-size:14px;padding:40px 20px;
    border:1px dashed var(--line);
    margin-top:10px;
  }

  /* --- Match ticket --- */
  .ticket{
    border:1px solid var(--line);
    border-top:2px solid var(--gold-dim);
    background:var(--pitch);
    margin-bottom:14px;
    padding:16px 14px;
  }
  .ticket-meta{
    display:flex;justify-content:space-between;
    font-size:11px;color:var(--chalk-dim);
    margin-bottom:12px;
  }
  .ticket-teams{
    display:flex;align-items:center;justify-content:space-between;gap:8px;
    margin-bottom:6px;
  }
  .team-chip{display:flex;flex-direction:column;align-items:center;gap:7px;flex:1;min-width:0;}
  .team-chip span.name{
    font-family:'Oswald', sans-serif;font-size:14px;color:var(--chalk);
    text-align:center;line-height:1.2;
  }
  .crest{
    width:36px;height:36px;border-radius:50%;flex:none;
    background:var(--pitch-light);border:1px solid var(--gold-dim);
    display:flex;align-items:center;justify-content:center;
    font-family:'Oswald', sans-serif;font-size:12px;color:var(--gold);
  }
  .ticket-teams .vs{font-size:11px;color:var(--chalk-dim);font-family:'Work Sans',sans-serif;flex:none;padding:0 4px;}
  .expand-hint{text-align:center;font-size:12px;color:var(--gold-dim);cursor:pointer;padding:2px 0 8px;}
  .market-label{font-size:11px;color:var(--gold-dim);margin:14px 0 7px;}
  .market-label:first-of-type{margin-top:0;}
  .player-props{border-top:1px dashed var(--line);padding-top:10px;margin-top:10px;}
  .player-props-name{font-family:'Oswald',sans-serif;font-size:13px;color:var(--chalk);margin-bottom:6px;}
  .prop-sublabel{font-size:10.5px;color:var(--chalk-dim);margin:6px 0 4px;}
  .odds-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
  .odds-btn{
    background:var(--pitch-deep);
    border:1px solid var(--line);
    color:var(--chalk);
    padding:10px 4px 8px;
    text-align:center;
    cursor:pointer;
    font-family:'Work Sans', sans-serif;
    transition:border-color 0.15s, transform 0.1s;
  }
  .odds-btn:hover{border-color:var(--gold-dim);}
  .odds-btn:active{transform:scale(0.97);}
  .odds-btn.selected{border-color:var(--gold);background:var(--pitch-light);}
  .odds-btn .lbl{display:block;font-size:11px;color:var(--chalk-dim);margin-bottom:4px;}
  .odds-btn .val{display:block;font-family:'Oswald',sans-serif;font-size:19px;color:var(--gold);}
  .ticket-result{
    text-align:center;font-family:'Oswald',sans-serif;font-size:22px;
    margin-bottom:6px;letter-spacing:1px;
  }
  .ticket-status{text-align:center;font-size:12px;color:var(--chalk-dim);}

  /* --- Bet slip (inline expand) --- */
  .slip{
    margin-top:12px;border-top:1px dashed var(--line);padding-top:12px;
  }
  .slip label{font-size:12px;color:var(--chalk-dim);display:block;margin-bottom:6px;}
  .slip-row{display:flex;gap:8px;align-items:center;}
  .slip input[type=number]{
    flex:1;background:var(--pitch-deep);border:1px solid var(--line);
    color:var(--chalk);padding:9px 10px;font-size:15px;font-family:'Work Sans',sans-serif;
  }
  .slip button.confirm{
    background:var(--gold);color:var(--ink);border:none;
    padding:9px 16px;font-family:'Oswald',sans-serif;font-weight:600;
    letter-spacing:0.3px;cursor:pointer;
  }
  .slip .payout{font-size:12px;color:var(--chalk-dim);margin-top:6px;}
  .slip .cancel{background:none;border:none;color:var(--chalk-dim);font-size:12px;text-decoration:underline;cursor:pointer;margin-top:8px;padding:0;}

  /* --- Bets list --- */
  .bet-row{
    display:flex;justify-content:space-between;align-items:center;
    border-bottom:1px solid var(--line);padding:12px 2px;font-size:14px;
  }
  .bet-row .desc{color:var(--chalk);}
  .bet-row .desc small{display:block;color:var(--chalk-dim);font-size:11px;margin-top:2px;}
  .bet-tag{font-family:'Oswald',sans-serif;font-size:14px;padding:2px 8px;border:1px solid var(--line);}
  .bet-tag.pending{color:var(--chalk-dim);}
  .bet-tag.win{color:var(--green-win);border-color:var(--green-win);}
  .bet-tag.lose{color:var(--red);border-color:var(--red);}

  /* --- Ranking --- */
  table.ranking{width:100%;border-collapse:collapse;font-size:14px;}
  table.ranking th{
    text-align:left;font-family:'Oswald',sans-serif;font-weight:500;
    color:var(--chalk-dim);font-size:11px;border-bottom:1px solid var(--line);padding:6px 4px;
  }
  table.ranking td{padding:12px 4px;border-bottom:1px solid var(--line);}
  table.ranking td.pos{font-family:'Oswald',sans-serif;color:var(--chalk-dim);width:26px;}
  table.ranking tr:nth-child(1) td.pos{color:var(--gold);}
  table.ranking tr:nth-child(2) td.pos{color:var(--chalk);}
  table.ranking tr:nth-child(3) td.pos{color:var(--gold-dim);}
  table.ranking td.bal{text-align:right;font-family:'Oswald',sans-serif;}

  /* --- Admin --- */
  .card{border:1px solid var(--line);background:var(--pitch);padding:16px;margin-bottom:16px;}
  .card h3{font-family:'Oswald',sans-serif;font-weight:500;font-size:14px;margin:0 0 12px;color:var(--gold);letter-spacing:0.3px;}
  .card label{display:block;font-size:12px;color:var(--chalk-dim);margin-bottom:5px;}
  .card select, .card input{
    width:100%;background:var(--pitch-deep);border:1px solid var(--line);
    color:var(--chalk);padding:9px 10px;font-size:14px;margin-bottom:10px;font-family:'Work Sans',sans-serif;
  }
  .card button{
    background:var(--gold);color:var(--ink);border:none;
    padding:10px 16px;font-family:'Oswald',sans-serif;font-weight:600;
    letter-spacing:0.3px;cursor:pointer;width:100%;
  }
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .team-line{display:flex;align-items:center;gap:10px;font-size:13px;padding:8px 0;border-bottom:1px solid var(--line);}
  .team-line .crest{width:26px;height:26px;font-size:10px;}
  .team-line .name{flex:1;}
  .team-line .rating{color:var(--chalk-dim);font-family:'Oswald',sans-serif;}
  .result-inline{display:flex;gap:8px;margin-top:8px;align-items:center;}
  .result-inline input{margin-bottom:0;text-align:center;}
  .result-inline .dash{color:var(--chalk-dim);font-family:'Oswald',sans-serif;font-size:18px;}
  .stat-player{border-top:1px dashed var(--line);padding-top:10px;margin-top:12px;}
  .stat-player-name{font-family:'Oswald',sans-serif;font-size:13px;color:var(--gold);margin-bottom:8px;}
  .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .stat-grid label{font-size:11px;margin-bottom:3px;}
  .stat-grid input{margin-bottom:0;}
  .stat-checks{display:flex;gap:16px;margin-top:8px;}
  .stat-checks label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--chalk-dim);margin-bottom:0;}
  .stat-checks input{width:auto;margin:0;}
  .toast{
    position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
    background:var(--gold);color:var(--ink);padding:10px 18px;
    font-family:'Oswald',sans-serif;font-weight:600;font-size:13px;
    opacity:0;pointer-events:none;transition:opacity 0.25s;z-index:20;
  }
  .toast.show{opacity:1;}

  /* --- Combinada (carrito de selecciones) --- */
  #cartBar{position:fixed;left:0;right:0;bottom:0;z-index:15;max-width:640px;margin:0 auto;}
  .cart-summary{
    background:var(--pitch-deep);border-top:2px solid var(--gold);
    padding:12px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;
  }
  .cart-summary .info{font-family:'Oswald',sans-serif;font-size:14px;color:var(--chalk);}
  .cart-summary .info small{display:block;font-size:11px;color:var(--chalk-dim);font-family:'Work Sans',sans-serif;margin-top:2px;}
  .cart-summary .toggle{font-family:'Oswald',sans-serif;color:var(--gold);font-size:13px;}
  .cart-panel{background:var(--pitch);border-top:1px solid var(--line);max-height:55vh;overflow-y:auto;padding:12px 16px 16px;}
  .cart-leg{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px;}
  .cart-leg small{display:block;color:var(--chalk-dim);font-size:11px;margin-top:2px;}
  .cart-leg .remove{background:none;border:none;color:var(--red);font-size:18px;cursor:pointer;padding:0 4px;line-height:1;}

  /* --- Name gate --- */
  .gate{
    min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:30px;text-align:center;
  }
  .gate h1{font-size:28px;margin-bottom:8px;}
  .gate p{color:var(--chalk-dim);font-size:14px;max-width:280px;margin-bottom:24px;}
  .gate input{
    width:100%;max-width:260px;background:var(--pitch);border:1px solid var(--line);
    color:var(--chalk);padding:12px 14px;font-size:16px;text-align:center;margin-bottom:14px;
    font-family:'Work Sans',sans-serif;
  }
  .gate button{
    background:var(--gold);color:var(--ink);border:none;
    padding:12px 30px;font-family:'Oswald',sans-serif;font-weight:600;font-size:15px;
    letter-spacing:0.3px;cursor:pointer;
  }
  .gate-shield{
    width:76px;height:76px;margin-bottom:18px;
    clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);
    background:linear-gradient(160deg, var(--pitch-light), var(--pitch));
    border:1px solid var(--gold-dim);
    display:flex;align-items:center;justify-content:center;
    font-family:'Oswald', sans-serif;font-weight:700;font-size:22px;color:var(--gold);
  }
</style>
</head>
<body>

<div id="gate" class="gate">
  <div class="gate-shield">CR</div>
  <h1 style="font-size:24px;">Copa del Rey</h1>
  <p>Elegí un usuario y contraseña. Si es la primera vez, se crea tu cuenta con 30.000 fichas; si ya la usaste antes, entrás a la misma.</p>
  <input id="nameInput" type="text" placeholder="Tu nombre de usuario" maxlength="20">
  <input id="passwordInput" type="password" placeholder="Contraseña" maxlength="30">
  <button onclick="joinAsPlayer()">Entrar</button>
</div>

<div id="app" class="wrap" style="display:none;">
  <header class="board">
    <div class="board-top">
      <div class="board-id">
        <div class="tourney-shield">CR</div>
        <div>
          <h1>Copa del Rey · Primera A</h1>
          <div class="subtitle">Cuotas calculadas según el nivel de cada equipo</div>
        </div>
      </div>
      <div class="player-box">
        <div class="player-name" id="playerNameLbl">—</div>
        <div class="chip-count"><span id="chipCount">1000</span> <span>fichas</span></div>
        <button class="switch-player" onclick="switchPlayer()">cambiar de jugador</button>
      </div>
    </div>
  </header>

  <nav class="tabs">
    <button data-tab="matches" class="active">Partidos</button>
    <button data-tab="mybets">Mis apuestas</button>
    <button data-tab="ranking">Tabla</button>
    <button data-tab="admin">Equipos</button>
  </nav>

  <main>
    <section id="tab-matches" class="active">
      <div id="matchesList"></div>
    </section>

    <section id="tab-mybets">
      <div id="myBetsList"></div>
    </section>

    <section id="tab-ranking">
      <table class="ranking">
        <thead><tr><th></th><th>Jugador</th><th style="text-align:right;">Fichas</th></tr></thead>
        <tbody id="rankingBody"></tbody>
      </table>
    </section>

    <section id="tab-admin">
      <div id="adminGate" class="card">
        <h3>Acceso de administrador</h3>
        <label>Contraseña de admin</label>
        <input id="adminPasswordInput" type="password" placeholder="Contraseña" onkeydown="if(event.key==='Enter')checkAdminPassword()">
        <button onclick="checkAdminPassword()">Entrar</button>
      </div>
      <div id="adminContent" style="display:none;">
      <div class="card">
        <h3>Agregar equipo</h3>
        <label>Nombre del equipo</label>
        <input id="newTeamName" type="text" placeholder="Ej: Deportivo Asado">
        <button onclick="addTeam()">Agregar equipo</button>
      </div>

      <div class="card" id="teamsCard">
        <h3>Equipos y nivel</h3>
        <div id="teamsList"></div>
      </div>

      <div class="card">
        <h3>Programar partido</h3>
        <label>Local</label>
        <select id="matchHome"></select>
        <label>Visitante</label>
        <select id="matchAway"></select>
        <button onclick="createMatch()">Crear partido y calcular cuotas</button>
      </div>

      <div class="card">
        <h3>Cargar resultado</h3>
        <label>Partido pendiente</label>
        <select id="pendingMatchSelect" onchange="renderPlayerStatsForm()"></select>
        <label>Marcador final</label>
        <div class="result-inline">
          <input id="scoreHome" type="number" min="0" placeholder="Local">
          <span class="dash">–</span>
          <input id="scoreAway" type="number" min="0" placeholder="Visitante">
        </div>
        <div id="playerStatsForm"></div>
        <br>
        <button onclick="submitResult()">Confirmar resultado</button>
      </div>
      <div style="text-align:center;font-size:11px;color:var(--chalk-dim);padding:8px 0 4px;">versión 2026-09-12-4</div>
      </div>
    </section>
  </main>
</div>

<div id="cartBar"></div>
<div id="toast" class="toast"></div>

<script>
const STARTING_CHIPS = 30000;
const K_FACTOR = 24;
const HOME_ADV = 60;
const OVERROUND = 1.08; // margen de la "casa"
const ADMIN_PASSWORD = 'leal2026';
let isAdmin = false;
let ME = null;
let STATE = { teams: [], matches: [], bets: [], users: {}, playerHistory: {} };

// ---------- storage helpers ----------
async function loadShared(key, fallback){
  try{
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : fallback;
  }catch(e){ return fallback; }
}
async function saveShared(key, value){
  try{ await window.storage.set(key, JSON.stringify(value), true); }catch(e){ /* ignorar */ }
}
async function loadPersonal(key){
  try{
    const r = await window.storage.get(key, false);
    return r ? r.value : null;
  }catch(e){ return null; }
}
async function savePersonal(key, value){
  try{ await window.storage.set(key, value, false); }catch(e){ /* ignorar */ }
}

async function loadAll(){
  STATE.teams = await loadShared('teams', []);
  STATE.matches = await loadShared('matches', []);
  STATE.bets = await loadShared('bets', []);
  STATE.users = await loadShared('users', {});
  STATE.playerHistory = await loadShared('playerHistory', {});
}
async function persist(part){
  if(part==='teams') await saveShared('teams', STATE.teams);
  if(part==='matches') await saveShared('matches', STATE.matches);
  if(part==='bets') await saveShared('bets', STATE.bets);
  if(part==='users') await saveShared('users', STATE.users);
  if(part==='playerHistory') await saveShared('playerHistory', STATE.playerHistory);
}

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function initials(name){
  const words = name.trim().split(/\s+/);
  if(words.length===1) return words[0].slice(0,2).toUpperCase();
  return (words[0][0]+words[1][0]).toUpperCase();
}

// ---------- odds engine ----------
function expectedHome(rHome, rAway){
  return 1/(1+Math.pow(10, (rAway-(rHome+HOME_ADV))/400));
}
function factorial(n){ let r=1; for(let i=2;i<=n;i++) r*=i; return r; }
function poissonPmf(k, lambda){
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function computeGoalsMarket(rHome, rAway){
  const GOALS_LINE = 2.5;
  let expectedTotal = 2.6 + (rHome+rAway-3000)/500;
  expectedTotal = Math.min(4.6, Math.max(1.4, expectedTotal));
  const pUnder = poissonPmf(0,expectedTotal)+poissonPmf(1,expectedTotal)+poissonPmf(2,expectedTotal);
  const pOver = 1-pUnder;
  const toOdds = p => Math.max(1.05, Math.round((1/p/OVERROUND)*100)/100);
  return { line: GOALS_LINE, expectedTotal, over: toOdds(pOver), under: toOdds(pUnder) };
}
function computeBttsMarket(expectedTotal, eHome){
  const shareHome = Math.min(0.75, Math.max(0.25, 0.5 + (eHome-0.5)*0.6));
  const lambdaHome = Math.max(0.3, expectedTotal*shareHome);
  const lambdaAway = Math.max(0.3, expectedTotal*(1-shareHome));
  const pHomeScores = 1 - poissonPmf(0, lambdaHome);
  const pAwayScores = 1 - poissonPmf(0, lambdaAway);
  const pYes = pHomeScores*pAwayScores;
  const toOdds = p => Math.max(1.05, Math.round((1/p/OVERROUND)*100)/100);
  return { yes: toOdds(pYes), no: toOdds(1-pYes) };
}
function computeOdds(rHome, rAway){
  const eHome = expectedHome(rHome, rAway);
  const closeness = 1 - Math.abs(eHome-0.5)*2; // 1 = parejo, 0 = muy dispar
  const pDraw = 0.22 + closeness*0.14;
  const pHome = eHome*(1-pDraw);
  const pAway = (1-eHome)*(1-pDraw);
  const toOdds = p => Math.max(1.05, Math.round((1/p/OVERROUND)*100)/100);
  const dc = {
    oneX: toOdds(pHome+pDraw),
    oneTwo: toOdds(pHome+pAway),
    xTwo: toOdds(pDraw+pAway)
  };
  const goals = computeGoalsMarket(rHome, rAway);
  const btts = computeBttsMarket(goals.expectedTotal, eHome);
  return { home: toOdds(pHome), draw: toOdds(pDraw), away: toOdds(pAway), dc, goals, btts };
}
function updateElo(rHome, rAway, outcome){
  // outcome: 1 = gana home, 0.5 = empate, 0 = gana away
  const eHome = expectedHome(rHome, rAway);
  const newHome = Math.round(rHome + K_FACTOR*(outcome-eHome));
  const newAway = Math.round(rAway + K_FACTOR*((1-outcome)-(1-eHome)));
  return { newHome, newAway };
}

// ---------- semilla: tabla y fixture reales del torneo ----------
const SEED_TEAMS = [
  { name:'Canilla Libre',   pts:10, gd:6  },
  { name:'Leal FC',         pts:10, gd:4  },
  { name:'La Sede',         pts:9,  gd:9  },
  { name:'Cementerio FC',   pts:7,  gd:5  },
  { name:'Retruco',         pts:7,  gd:2  },
  { name:'Carlos Casares',  pts:3,  gd:-4 },
  { name:'DDFC',            pts:0,  gd:-9 },
  { name:'Vaya al frente',  pts:0,  gd:-13 }
];
const SEED_FIXTURE = [
  ['Retruco', 'Canilla Libre'],
  ['Leal FC', 'La Sede'],
  ['Cementerio FC', 'Carlos Casares'],
  ['DDFC', 'Vaya al frente']
];
function seedRating(team){
  const avgPts = SEED_TEAMS.reduce((s,t)=>s+t.pts,0) / SEED_TEAMS.length;
  return Math.round(1500 + (team.pts-avgPts)*25 + team.gd*10);
}
async function seedIfEmpty(){
  if(STATE.teams.length > 0) return;
  STATE.teams = SEED_TEAMS.map(t => ({ id: uid(), name: t.name, rating: seedRating(t) }));
  STATE.matches = SEED_FIXTURE.map(([homeName, awayName]) => {
    const home = STATE.teams.find(t=>t.name===homeName);
    const away = STATE.teams.find(t=>t.name===awayName);
    return {
      id: uid(), homeId: home.id, awayId: away.id, homeName, awayName,
      odds: computeOdds(home.rating, away.rating),
      status: 'upcoming', result: null, createdAt: Date.now()
    };
  });
  await persist('teams');
  await persist('matches');
}

// arregla datos guardados de versiones viejas (partidos sin doble oportunidad/goles,
// apuestas con el formato simple de antes) para que no rompan el resto de la app
async function normalizeState(){
  const teamIds = new Set(STATE.teams.map(t=>t.id));
  const before = STATE.matches.length;
  STATE.matches = STATE.matches.filter(m => teamIds.has(m.homeId) && teamIds.has(m.awayId));
  let matchesChanged = STATE.matches.length !== before;
  for(const m of STATE.matches){
    if(!m.odds || !m.odds.dc || !m.odds.goals || !m.odds.btts){
      const home = STATE.teams.find(t=>t.id===m.homeId);
      const away = STATE.teams.find(t=>t.id===m.awayId);
      m.odds = computeOdds(home.rating, away.rating);
      matchesChanged = true;
    }
  }
  let betsChanged = false;
  STATE.bets = STATE.bets.map(b=>{
    if(Array.isArray(b.legs)) return b;
    betsChanged = true;
    return {
      id: b.id, user: b.user, stake: b.stake,
      combinedOdds: b.oddsAtBet,
      legs: [{ matchId: b.matchId, pick: b.pick, oddsAtBet: b.oddsAtBet, result: b.settled ? (b.won ? true : false) : null }],
      settled: !!b.settled, won: !!b.won, placedAt: b.placedAt || Date.now()
    };
  });
  if(matchesChanged) await persist('matches');
  if(betsChanged) await persist('bets');

  // ajuste único: arranque limpio con 30.000 fichas para todos y sin apuestas de prueba
  const bumped = await loadShared('creditsBumpV1', false);
  if(!bumped){
    for(const user in STATE.users){
      const existing = STATE.users[user];
      const password = (existing && typeof existing === 'object') ? existing.password : null;
      STATE.users[user] = { balance: STARTING_CHIPS, password };
    }
    STATE.bets = [];
    await persist('users');
    await persist('bets');
    await saveShared('creditsBumpV1', true);
  }

  // ajuste único: limpiar historial de jugadores de LEAL cargado de pruebas anteriores,
  // para que las cuotas vuelvan a salir tal cual la lista base
  const historyReset = await loadShared('playerHistoryResetV1', false);
  if(!historyReset){
    STATE.playerHistory = {};
    await persist('playerHistory');
    await saveShared('playerHistoryResetV1', true);
  }
}

// ---------- props de jugadores de LEAL (solo se muestran en partidos de LEAL) ----------
const LEAL_TEAM_NAME = 'Leal FC';
const LEAL_PROPS = {
  'Alexis Villarreal': { atajadas: {2:1.40, 3:2.50, 4:3.75} },
  'Luca Forteis': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.90, 2:3, 3:7},
    remates_arco: {1:3, 2:10},
    gol: 20, asistencia: 10, amarilla: 2.50, roja: 30
  },
  'Nahuel Troncellito': {
    faltas: {1:1.30, 2:2, 3:3},
    remates: {1:1.70, 2:3, 3:7},
    remates_arco: {1:3, 2:10},
    gol: 20, asistencia: 10, amarilla: 1.70, roja: 20
  },
  'Juan Perdomo': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:2.50, 2:5.50, 3:13},
    remates_arco: {1:3, 2:10},
    gol: 40, asistencia: 20, amarilla: 2.50, roja: 30
  },
  'Leo Figueroa': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.90, 2:3, 3:7},
    remates_arco: {1:3, 2:10},
    gol: 20, asistencia: 10, amarilla: 2.50, roja: 30
  },
  'Tino Plini': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.90, 2:3, 3:7},
    remates_arco: {1:3, 2:10},
    gol: 20, asistencia: 10, amarilla: 2.50, roja: 30
  },
  'Mati Dabeni': {
    faltas: {1:1.70, 2:2.80, 3:4.50},
    remates: {1:1.50, 2:2.75, 3:5},
    remates_arco: {1:2.80, 2:7},
    gol: 12, asistencia: 5, amarilla: 2, roja: 19
  },
  'Lisandro Moretti': {
    faltas: {1:1.60, 2:2.80, 3:4.50},
    remates: {1:1.50, 2:2.75, 3:5},
    remates_arco: {1:2.80, 2:7},
    gol: 12, asistencia: 5, amarilla: 3, roja: 30
  },
  'Lauti Crescitelli': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.40, 2:2.20, 3:4.20},
    remates_arco: {1:2.50, 2:7},
    gol: 15, asistencia: 5, amarilla: 2, roja: 20
  },
  'Nico Monteverde': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.80, 2:3, 3:7},
    remates_arco: {1:3, 2:10},
    gol: 20, asistencia: 10, amarilla: 2.75, roja: 30
  },
  'Feli Cantero': {
    faltas: {1:1.70, 2:2.70, 3:4.50},
    remates: {1:1.30, 2:2, 3:4.33},
    remates_arco: {1:2, 2:5},
    gol: 7, asistencia: 4, amarilla: 2, roja: 30
  },
  'Eli Peñaloza': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {2:1.70, 3:3, 4:7},
    remates_arco: {1:2, 2:4.50},
    gol: 5, asistencia: 4, amarilla: 2, roja: 30
  },
  'Grachi Bellagamba': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {2:1.60, 3:2.75, 4:5},
    remates_arco: {1:1.80, 2:4},
    gol: 5, asistencia: 5, amarilla: 3, roja: 30
  },
  'Nacho Sarru': {
    faltas: {1:1.70, 2:2.70, 3:4.33},
    remates: {1:1.40, 2:2.50, 3:6},
    remates_arco: {1:2, 2:5},
    gol: 7, asistencia: 7, amarilla: 3.50, roja: 30
  },
  'Jota Undagarin': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.60, 2:2.90, 3:6},
    remates_arco: {1:2.80, 2:7},
    gol: 10, asistencia: 7, amarilla: 2.33, roja: 30
  },
  'Axel Desiderio': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.40, 2:2.33, 3:4},
    remates_arco: {1:2, 2:7},
    gol: 11, asistencia: 8, amarilla: 4, roja: 30
  },
  'Bauti Marche': {
    faltas: {1:1.50, 2:2.40, 3:4},
    remates: {1:1.40, 2:2.33, 3:4},
    remates_arco: {1:2, 2:7},
    gol: 11, asistencia: 8, amarilla: 4, roja: 30
  }
};
async function syncLealProps(){
  const m = STATE.matches.find(mm => mm.status==='upcoming' && (mm.homeName===LEAL_TEAM_NAME || mm.awayName===LEAL_TEAM_NAME));
  if(!m) return;
  const dynamicProps = buildDynamicLealProps(LEAL_PROPS, STATE.playerHistory);
  if(JSON.stringify(m.playerProps) === JSON.stringify(dynamicProps)) return;
  m.playerProps = dynamicProps;
  await persist('matches');
}

// ---------- cuotas de jugador dinámicas: combina la lista base con lo que realmente vino haciendo ----------
const PRIOR_WEIGHT = 3; // la lista base "pesa" como si fueran 3 partidos de referencia
function buildDynamicLealProps(baseline, history){
  const toOdds = p => Math.max(1.05, Math.round((1/p/OVERROUND)*100)/100);
  const impliedProb = odds => 1/(odds*OVERROUND);
  const result = {};
  for(const playerName in baseline){
    const base = baseline[playerName];
    const hist = history[playerName] || [];
    const n = hist.length;
    const out = {};
    for(const market of ['atajadas','faltas','remates','remates_arco']){
      if(!base[market]) continue;
      out[market] = {};
      for(const k in base[market]){
        const kNum = Number(k);
        const priorProb = impliedProb(base[market][k]);
        const successCount = hist.filter(h => (h[market]||0) >= kNum).length;
        const prob = (priorProb*PRIOR_WEIGHT + successCount) / (PRIOR_WEIGHT + n);
        out[market][k] = toOdds(prob);
      }
    }
    for(const market of ['gol','asistencia','amarilla','roja']){
      if(base[market]===undefined) continue;
      const priorProb = impliedProb(base[market]);
      let successCount = 0;
      if(market==='gol') successCount = hist.filter(h=>(h.gol||0)>=1).length;
      else if(market==='asistencia') successCount = hist.filter(h=>(h.asistencia||0)>=1).length;
      else if(market==='amarilla') successCount = hist.filter(h=>!!h.amarilla).length;
      else if(market==='roja') successCount = hist.filter(h=>!!h.roja).length;
      const prob = (priorProb*PRIOR_WEIGHT + successCount) / (PRIOR_WEIGHT + n);
      out[market] = toOdds(prob);
    }
    result[playerName] = out;
  }
  return result;
}

// ---------- player join ----------
async function joinAsPlayer(){
  const name = document.getElementById('nameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  if(!name){ toast('Escribí un nombre de usuario'); return; }
  if(!password){ toast('Escribí una contraseña'); return; }
  const existing = STATE.users[name];
  if(existing){
    if(existing.password===null || existing.password===undefined){
      existing.password = password; // cuenta vieja sin contraseña: se la asigna ahora
      await persist('users');
    }else if(existing.password !== password){
      toast('Contraseña incorrecta para ese usuario');
      return;
    }
  }else{
    STATE.users[name] = { balance: STARTING_CHIPS, password };
    await persist('users');
  }
  ME = name;
  await savePersonal('my-name', name);
  await savePersonal('my-password', password);
  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderAll();
}
function switchPlayer(){
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('nameInput').value = '';
  document.getElementById('passwordInput').value = '';
}

async function checkAdminPassword(){
  const input = document.getElementById('adminPasswordInput');
  if(input.value !== ADMIN_PASSWORD){
    toast('Contraseña de admin incorrecta');
    return;
  }
  isAdmin = true;
  await savePersonal('is-admin', 'yes');
  document.getElementById('adminGate').style.display = 'none';
  document.getElementById('adminContent').style.display = 'block';
  renderAdmin();
}

// ---------- tabs ----------
document.querySelectorAll('nav.tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('main section').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab==='admin' && isAdmin) renderAdmin();
  });
});

// ---------- teams / matches admin ----------
async function addTeam(){
  const input = document.getElementById('newTeamName');
  const name = input.value.trim();
  if(!name) return;
  STATE.teams.push({ id: uid(), name, rating: 1500 });
  await persist('teams');
  input.value = '';
  renderAdmin();
  toast('Equipo agregado');
}

async function createMatch(){
  const homeId = document.getElementById('matchHome').value;
  const awayId = document.getElementById('matchAway').value;
  if(!homeId || !awayId || homeId===awayId){ toast('Elegí dos equipos distintos'); return; }
  const home = STATE.teams.find(t=>t.id===homeId);
  const away = STATE.teams.find(t=>t.id===awayId);
  const odds = computeOdds(home.rating, away.rating);
  STATE.matches.push({
    id: uid(), homeId, awayId, homeName: home.name, awayName: away.name,
    odds, status: 'upcoming', result: null, createdAt: Date.now()
  });
  await persist('matches');
  await syncLealProps();
  renderAll();
  toast('Partido creado con cuotas');
}

function evaluateBet(pick, result){
  if(pick.startsWith('prop|')){
    const { playerName, market, threshold } = parsePropPick(pick);
    const stats = result.playerStats && result.playerStats[playerName];
    if(!stats) return false;
    if(market==='gol') return (stats.gol||0) >= 1;
    if(market==='asistencia') return (stats.asistencia||0) >= 1;
    if(market==='amarilla') return !!stats.amarilla;
    if(market==='roja') return !!stats.roja;
    return (stats[market]||0) >= threshold;
  }
  if(pick==='home' || pick==='draw' || pick==='away') return pick===result.outcome;
  if(pick==='dc_1x') return result.outcome==='home' || result.outcome==='draw';
  if(pick==='dc_12') return result.outcome==='home' || result.outcome==='away';
  if(pick==='dc_x2') return result.outcome==='draw' || result.outcome==='away';
  if(pick==='goals_over') return result.totalGoals > 2.5;
  if(pick==='goals_under') return result.totalGoals < 2.5;
  if(pick==='btts_yes') return result.homeGoals>0 && result.awayGoals>0;
  if(pick==='btts_no') return !(result.homeGoals>0 && result.awayGoals>0);
  return false;
}

async function reopenMatch(matchId){
  const match = STATE.matches.find(m=>m.id===matchId);
  if(!match) return;
  match.status = 'upcoming';
  match.result = null;
  for(const bet of STATE.bets){
    if(bet.cancelled) continue;
    const touchedLegs = bet.legs.filter(l=>l.matchId===matchId);
    if(touchedLegs.length===0) continue;
    if(bet.settled){
      if(bet.voided){
        STATE.users[bet.user].balance = (STATE.users[bet.user].balance||0) - bet.stake;
      }else if(bet.won){
        const paidOdds = bet.effectiveOdds || bet.combinedOdds;
        STATE.users[bet.user].balance = (STATE.users[bet.user].balance||0) - bet.stake*paidOdds;
      }
    }
    touchedLegs.forEach(l => l.result = null);
    bet.settled = false;
    bet.won = false;
    bet.voided = false;
    delete bet.effectiveOdds;
  }
  await persist('matches');
  await persist('bets');
  await persist('users');
  await syncLealProps();
  renderAll();
  toast('Partido reabierto');
}

async function submitResult(){
  const matchId = document.getElementById('pendingMatchSelect').value;
  const hg = parseInt(document.getElementById('scoreHome').value, 10);
  const ag = parseInt(document.getElementById('scoreAway').value, 10);
  if(!matchId || isNaN(hg) || isNaN(ag)){ toast('Cargá el marcador completo'); return; }
  const match = STATE.matches.find(m=>m.id===matchId);
  const home = STATE.teams.find(t=>t.id===match.homeId);
  const away = STATE.teams.find(t=>t.id===match.awayId);
  const outcome = hg>ag ? 'home' : hg<ag ? 'away' : 'draw';
  const eloOutcome = hg>ag ? 1 : hg<ag ? 0 : 0.5;
  const { newHome, newAway } = updateElo(home.rating, away.rating, eloOutcome);
  home.rating = newHome;
  away.rating = newAway;
  match.status = 'finished';
  let playerStats = null;
  let didNotPlay = new Set();
  if(match.playerProps){
    playerStats = {};
    document.querySelectorAll('#playerStatsForm .statInput').forEach(inp=>{
      const player = inp.dataset.player, market = inp.dataset.market;
      playerStats[player] = playerStats[player] || {};
      playerStats[player][market] = parseInt(inp.value,10) || 0;
    });
    document.querySelectorAll('#playerStatsForm .statCheck').forEach(chk=>{
      const player = chk.dataset.player, market = chk.dataset.market;
      playerStats[player] = playerStats[player] || {};
      playerStats[player][market] = chk.checked;
    });
    document.querySelectorAll('#playerStatsForm .statDidNotPlay').forEach(chk=>{
      if(!chk.checked) return; // no jugó: no se cuenta en su historial
      didNotPlay.add(chk.dataset.player);
      delete playerStats[chk.dataset.player];
    });
  }
  match.result = { outcome, homeGoals: hg, awayGoals: ag, totalGoals: hg+ag, playerStats };
  await persist('teams');
  await persist('matches');

  if(playerStats){
    for(const playerName in playerStats){
      STATE.playerHistory[playerName] = STATE.playerHistory[playerName] || [];
      STATE.playerHistory[playerName].push(playerStats[playerName]);
    }
    await persist('playerHistory');
  }

  // liquidar apuestas (simples y combinadas) que tengan una pata en este partido
  for(const bet of STATE.bets){
    if(bet.settled || bet.cancelled) continue;
    let touched = false;
    for(const leg of bet.legs){
      if(leg.matchId===matchId && leg.result===null){
        if(leg.pick.startsWith('prop|') && didNotPlay.has(parsePropPick(leg.pick).playerName)){
          leg.result = 'void'; // el jugador no jugó: esta pata se anula, no cuenta ni a favor ni en contra
        }else{
          leg.result = evaluateBet(leg.pick, match.result);
        }
        touched = true;
      }
    }
    if(!touched) continue;
    const anyLost = bet.legs.some(l=>l.result===false);
    const anyPending = bet.legs.some(l=>l.result===null);
    if(anyLost){
      bet.settled = true;
      bet.won = false;
    }else if(!anyPending){
      const activeLegs = bet.legs.filter(l=>l.result!=='void');
      bet.settled = true;
      if(activeLegs.length===0){
        // se anularon todas las patas: se devuelve el monto apostado, ni gana ni pierde
        bet.won = null;
        bet.voided = true;
        STATE.users[bet.user].balance = (STATE.users[bet.user].balance||0) + bet.stake;
      }else{
        bet.won = true;
        bet.effectiveOdds = Math.round(activeLegs.reduce((p,l)=>p*l.oddsAtBet,1)*100)/100;
        STATE.users[bet.user].balance = (STATE.users[bet.user].balance||0) + bet.stake*bet.effectiveOdds;
      }
    }
    // si todavía hay patas pendientes y ninguna perdió, la apuesta sigue "pendiente"
  }
  await persist('bets');
  await persist('users');
  await syncLealProps();
  renderAll();
  toast('Resultado cargado, fichas actualizadas');
}

// ---------- combinada (carrito de selecciones) ----------
let CART = [];
let cartPanelOpen = false;
let expandedMatches = new Set();

function toggleMatchExpand(matchId){
  if(expandedMatches.has(matchId)) expandedMatches.delete(matchId);
  else expandedMatches.add(matchId);
  renderMatches();
}

function toggleLeg(matchId, pick){
  const m = STATE.matches.find(mm=>mm.id===matchId);
  const odds = oddsFor(m, pick);
  const label = pickLabel(pick, m);
  const matchLabel = `${m.homeName} vs ${m.awayName}`;
  const existingIndex = CART.findIndex(l=>l.matchId===matchId && l.pick===pick);
  if(existingIndex>-1){
    CART.splice(existingIndex,1);
  }else{
    CART.push({ matchId, pick, odds, label, matchLabel });
  }
  renderMatches();
  renderCartBar();
}
function removeFromCart(i){
  CART.splice(i,1);
  if(CART.length===0) cartPanelOpen = false;
  renderMatches();
  renderCartBar();
}
function toggleCartPanel(){
  cartPanelOpen = !cartPanelOpen;
  renderCartBar();
}
function combinedOddsValue(){
  return Math.round(CART.reduce((p,l)=>p*l.odds,1)*100)/100;
}
function updateComboPreview(){
  const val = parseInt(document.getElementById('comboStake').value,10) || 0;
  const odds = combinedOddsValue();
  document.getElementById('comboPreview').textContent =
    val>0 ? `Si acertás todo, cobrás ${Math.round(val*odds)} fichas` : `Si acertás todo, cobrás fichas × ${odds}`;
}
async function confirmCombo(){
  const stakeInput = document.getElementById('comboStake');
  const stake = parseInt(stakeInput.value, 10);
  const balance = (STATE.users[ME] && STATE.users[ME].balance) || 0;
  if(CART.length===0){ toast('Elegí al menos una selección'); return; }
  if(!stake || stake<=0){ toast('Poné un monto válido'); return; }
  if(stake > balance){ toast('No tenés esa cantidad de fichas'); return; }
  const combinedOdds = combinedOddsValue();
  const legs = CART.map(l=>({ matchId: l.matchId, pick: l.pick, oddsAtBet: l.odds, result: null }));
  STATE.bets.push({
    id: uid(), user: ME, stake, combinedOdds, legs,
    settled:false, won:false, cancelled:false, placedAt: Date.now()
  });
  STATE.users[ME].balance = balance - stake;
  await persist('bets');
  await persist('users');
  const wasCombo = CART.length > 1;
  CART = [];
  cartPanelOpen = false;
  renderAll();
  toast(wasCombo ? 'Combinada confirmada' : 'Apuesta confirmada');
}

// ---------- rendering ----------
const PROP_MARKET_LABEL = {
  atajadas: 'atajadas', faltas: 'faltas cometidas', remates: 'remates',
  remates_arco: 'remates al arco', gol: 'gol', asistencia: 'asistencia',
  amarilla: 'tarjeta amarilla', roja: 'tarjeta roja'
};
function parsePropPick(pick){
  const [, playerName, market, threshold] = pick.split('|');
  return { playerName, market, threshold: threshold ? parseInt(threshold,10) : null };
}
function pickLabel(pick, m){
  if(pick.startsWith('prop|')){
    const { playerName, market, threshold } = parsePropPick(pick);
    return threshold!==null
      ? `${playerName}: ${threshold}+ ${PROP_MARKET_LABEL[market]}`
      : `${playerName}: ${PROP_MARKET_LABEL[market]}`;
  }
  if(pick==='home') return m.homeName;
  if(pick==='away') return m.awayName;
  if(pick==='draw') return 'Empate';
  if(pick==='dc_1x') return m.homeName+' o empate';
  if(pick==='dc_12') return m.homeName+' o '+m.awayName;
  if(pick==='dc_x2') return 'Empate o '+m.awayName;
  if(pick==='goals_over') return 'Más de '+m.odds.goals.line+' goles';
  if(pick==='goals_under') return 'Menos de '+m.odds.goals.line+' goles';
  if(pick==='btts_yes') return 'Ambos anotan: sí';
  if(pick==='btts_no') return 'Ambos anotan: no';
  return pick;
}
function oddsFor(m, pick){
  if(pick.startsWith('prop|')){
    const { playerName, market, threshold } = parsePropPick(pick);
    const props = m.playerProps[playerName];
    return threshold!==null ? props[market][threshold] : props[market];
  }
  if(pick==='home') return m.odds.home;
  if(pick==='away') return m.odds.away;
  if(pick==='draw') return m.odds.draw;
  if(pick==='dc_1x') return m.odds.dc.oneX;
  if(pick==='dc_12') return m.odds.dc.oneTwo;
  if(pick==='dc_x2') return m.odds.dc.xTwo;
  if(pick==='goals_over') return m.odds.goals.over;
  if(pick==='goals_under') return m.odds.goals.under;
  if(pick==='btts_yes') return m.odds.btts.yes;
  if(pick==='btts_no') return m.odds.btts.no;
  return null;
}
function sel(m, pick){
  return CART.some(l=>l.matchId===m.id && l.pick===pick) ? ' selected' : '';
}
function renderCartBar(){
  const bar = document.getElementById('cartBar');
  if(!bar) return;
  if(CART.length===0){ bar.innerHTML = ''; return; }
  const combinedOdds = combinedOddsValue();
  let html = `<div class="cart-summary" onclick="toggleCartPanel()">
    <div class="info">${CART.length} ${CART.length===1 ? 'selección' : 'selecciones'}<small>cuota combinada ${combinedOdds}</small></div>
    <div class="toggle">${cartPanelOpen ? 'Cerrar' : 'Ver apuesta'}</div>
  </div>`;
  if(cartPanelOpen){
    html += `<div class="cart-panel">`;
    CART.forEach((l,i)=>{
      html += `<div class="cart-leg">
        <span>${l.matchLabel}<small>${l.label} · cuota ${l.odds}</small></span>
        <button class="remove" onclick="removeFromCart(${i})">✕</button>
      </div>`;
    });
    html += `<div class="slip" style="border-top:none;padding-top:12px;">
      <label>Monto a apostar (fichas)</label>
      <div class="slip-row">
        <input id="comboStake" type="number" min="1" placeholder="Fichas" oninput="updateComboPreview()">
        <button class="confirm" onclick="confirmCombo()">Confirmar</button>
      </div>
      <div class="payout" id="comboPreview">Si acertás todo, cobrás fichas × ${combinedOdds}</div>
    </div>`;
    html += `</div>`;
  }
  bar.innerHTML = html;
}

function renderPlayerPropsBlock(m){
  const THRESHOLD_MARKETS = [
    ['atajadas','Atajadas'], ['faltas','Faltas cometidas'],
    ['remates','Remates'], ['remates_arco','Remates al arco']
  ];
  const BINARY_MARKETS = [
    ['gol','Gol'], ['asistencia','Asistencia'], ['amarilla','Amarilla'], ['roja','Roja']
  ];
  let html = `<div class="market-label">Jugadores de LEAL</div>`;
  for(const playerName in m.playerProps){
    const props = m.playerProps[playerName];
    html += `<div class="player-props"><div class="player-props-name">${playerName}</div>`;
    for(const [market, label] of THRESHOLD_MARKETS){
      if(!props[market]) continue;
      const thresholds = Object.keys(props[market]);
      html += `<div class="prop-sublabel">${label}</div><div class="odds-row" style="grid-template-columns:repeat(${thresholds.length},1fr);">`;
      for(const t of thresholds){
        const pick = `prop|${playerName}|${market}|${t}`;
        html += `<div class="odds-btn${sel(m,pick)}" onclick="toggleLeg('${m.id}','${pick}')"><span class="lbl">${t}+</span><span class="val">${props[market][t]}</span></div>`;
      }
      html += `</div>`;
    }
    const activeBinary = BINARY_MARKETS.filter(([market]) => props[market]!==undefined);
    if(activeBinary.length){
      html += `<div class="odds-row" style="grid-template-columns:repeat(${activeBinary.length},1fr);margin-top:6px;">`;
      for(const [market, label] of activeBinary){
        const pick = `prop|${playerName}|${market}`;
        html += `<div class="odds-btn${sel(m,pick)}" onclick="toggleLeg('${m.id}','${pick}')"><span class="lbl">${label}</span><span class="val">${props[market]}</span></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  return html;
}

function renderMatches(){
  const list = document.getElementById('matchesList');
  const upcoming = STATE.matches.filter(m=>m.status==='upcoming').sort((a,b)=>b.createdAt-a.createdAt);
  const finished = STATE.matches.filter(m=>m.status==='finished').sort((a,b)=>b.createdAt-a.createdAt);
  if(STATE.matches.length===0){
    list.innerHTML = '<div class="empty">Todavía no hay partidos cargados.<br>Andá a la pestaña Equipos para programar el primero.</div>';
    return;
  }
  let html = '';
  for(const m of upcoming){
    const isOpen = expandedMatches.has(m.id);
    html += `<div class="ticket">
      <div class="ticket-meta"><span>Próximo</span><span>#${m.id.slice(-4)}</span></div>
      <div class="ticket-teams" onclick="toggleMatchExpand('${m.id}')" style="cursor:pointer;">
        <div class="team-chip"><span class="crest">${initials(m.homeName)}</span><span class="name">${m.homeName}</span></div>
        <span class="vs">vs</span>
        <div class="team-chip"><span class="crest">${initials(m.awayName)}</span><span class="name">${m.awayName}</span></div>
      </div>
      <div class="expand-hint" onclick="toggleMatchExpand('${m.id}')">${isOpen ? 'Ocultar apuestas ▴' : 'Ver apuestas de este partido ▾'}</div>`;

    if(isOpen){
      html += `
      <div class="market-label">Resultado</div>
      <div class="odds-row">
        <div class="odds-btn${sel(m,'home')}" onclick="toggleLeg('${m.id}','home')"><span class="lbl">${m.homeName}</span><span class="val">${m.odds.home}</span></div>
        <div class="odds-btn${sel(m,'draw')}" onclick="toggleLeg('${m.id}','draw')"><span class="lbl">Empate</span><span class="val">${m.odds.draw}</span></div>
        <div class="odds-btn${sel(m,'away')}" onclick="toggleLeg('${m.id}','away')"><span class="lbl">${m.awayName}</span><span class="val">${m.odds.away}</span></div>
      </div>

      <div class="market-label">Doble oportunidad</div>
      <div class="odds-row">
        <div class="odds-btn${sel(m,'dc_1x')}" onclick="toggleLeg('${m.id}','dc_1x')"><span class="lbl">${m.homeName} o X</span><span class="val">${m.odds.dc.oneX}</span></div>
        <div class="odds-btn${sel(m,'dc_12')}" onclick="toggleLeg('${m.id}','dc_12')"><span class="lbl">1 o 2</span><span class="val">${m.odds.dc.oneTwo}</span></div>
        <div class="odds-btn${sel(m,'dc_x2')}" onclick="toggleLeg('${m.id}','dc_x2')"><span class="lbl">X o ${m.awayName}</span><span class="val">${m.odds.dc.xTwo}</span></div>
      </div>

      <div class="market-label">Goles (línea ${m.odds.goals.line})</div>
      <div class="odds-row" style="grid-template-columns:1fr 1fr;">
        <div class="odds-btn${sel(m,'goals_over')}" onclick="toggleLeg('${m.id}','goals_over')"><span class="lbl">Más de ${m.odds.goals.line}</span><span class="val">${m.odds.goals.over}</span></div>
        <div class="odds-btn${sel(m,'goals_under')}" onclick="toggleLeg('${m.id}','goals_under')"><span class="lbl">Menos de ${m.odds.goals.line}</span><span class="val">${m.odds.goals.under}</span></div>
      </div>

      <div class="market-label">Ambos equipos anotan</div>
      <div class="odds-row" style="grid-template-columns:1fr 1fr;">
        <div class="odds-btn${sel(m,'btts_yes')}" onclick="toggleLeg('${m.id}','btts_yes')"><span class="lbl">Sí</span><span class="val">${m.odds.btts.yes}</span></div>
        <div class="odds-btn${sel(m,'btts_no')}" onclick="toggleLeg('${m.id}','btts_no')"><span class="lbl">No</span><span class="val">${m.odds.btts.no}</span></div>
      </div>${m.playerProps ? renderPlayerPropsBlock(m) : ''}`;
    }
    html += `</div>`;
  }
  for(const m of finished){
    const r = m.result;
    html += `<div class="ticket" style="opacity:0.75;">
      <div class="ticket-meta"><span>Finalizado</span><span>#${m.id.slice(-4)}</span></div>
      <div class="ticket-teams">
        <div class="team-chip"><span class="crest">${initials(m.homeName)}</span><span class="name">${m.homeName}</span></div>
        <span class="vs">vs</span>
        <div class="team-chip"><span class="crest">${initials(m.awayName)}</span><span class="name">${m.awayName}</span></div>
      </div>
      <div class="ticket-result">${r.homeGoals} - ${r.awayGoals}</div>
      <div class="ticket-status">1x2: ${m.odds.home} / ${m.odds.draw} / ${m.odds.away} · Goles ${m.odds.goals.line}: ${m.odds.goals.over} / ${m.odds.goals.under} · Ambos anotan: ${m.odds.btts.yes} / ${m.odds.btts.no}</div>
      <div style="text-align:center;margin-top:10px;">
        <button onclick="reopenMatch('${m.id}')" style="background:none;border:1px solid var(--line);color:var(--chalk-dim);padding:7px 14px;font-family:'Work Sans',sans-serif;font-size:12px;cursor:pointer;">Reabrir partido (corregir resultado)</button>
      </div>
    </div>`;
  }
  list.innerHTML = html;
}

async function cashOutBet(betId){
  const bet = STATE.bets.find(b=>b.id===betId);
  if(!bet || bet.user!==ME || bet.settled || bet.cancelled) return;
  bet.cancelled = true;
  STATE.users[ME].balance = (STATE.users[ME].balance||0) + bet.stake;
  await persist('bets');
  await persist('users');
  renderAll();
  toast('Apuesta cerrada, se te devolvieron las fichas');
}

function renderMyBets(){
  const list = document.getElementById('myBetsList');
  const mine = STATE.bets.filter(b=>b.user===ME).sort((a,b)=>b.placedAt-a.placedAt);
  if(mine.length===0){
    list.innerHTML = '<div class="empty">Todavía no hiciste ninguna apuesta.</div>';
    return;
  }
  list.innerHTML = mine.map(b=>{
    const legsDesc = b.legs.map(l=>{
      const m = STATE.matches.find(mm=>mm.id===l.matchId);
      const label = m ? `${pickLabel(l.pick,m)} (${m.homeName} vs ${m.awayName})` : pickLabel(l.pick, {homeName:'?',awayName:'?',odds:{goals:{line:2.5}}});
      return l.result==='void' ? `${label} — anulada` : label;
    }).join(' + ');
    const payoutOdds = b.effectiveOdds || b.combinedOdds;
    const tag = b.cancelled ? `<span class="bet-tag pending">Cancelada</span>` :
      b.voided ? `<span class="bet-tag pending">Anulada (devuelto)</span>` :
      !b.settled ? `<span class="bet-tag pending">Pendiente</span>` :
      b.won ? `<span class="bet-tag win">+${Math.round(b.stake*payoutOdds)}</span>` :
      `<span class="bet-tag lose">-${b.stake}</span>`;
    const comboTag = b.legs.length>1 ? 'Combinada · ' : '';
    const potentialOdds = Math.round(b.legs.filter(l=>l.result!=='void').reduce((p,l)=>p*l.oddsAtBet,1)*100)/100;
    const potentialText = (!b.settled && !b.cancelled)
      ? ` · si ganás, cobrás ${Math.round(b.stake*potentialOdds)} fichas`
      : '';
    const cashOutBtn = (!b.settled && !b.cancelled)
      ? `<button onclick="cashOutBet('${b.id}')" style="margin-top:8px;background:none;border:1px solid var(--line);color:var(--chalk-dim);padding:6px 12px;font-family:'Work Sans',sans-serif;font-size:12px;cursor:pointer;">Cerrar apuesta (devolver ${b.stake} fichas)</button>`
      : '';
    return `<div class="bet-row" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="desc">${legsDesc}<small>${comboTag}${b.stake} fichas a cuota ${b.combinedOdds}${potentialText}</small></div>
        ${tag}
      </div>
      ${cashOutBtn}
    </div>`;
  }).join('');
}

function renderRanking(){
  const body = document.getElementById('rankingBody');
  const rows = Object.entries(STATE.users).sort((a,b)=>b[1].balance-a[1].balance);
  body.innerHTML = rows.map((r,i)=>`<tr>
    <td class="pos">${i+1}</td>
    <td>${r[0]}${r[0]===ME ? ' (vos)' : ''}</td>
    <td class="bal">${Math.round(r[1].balance)}</td>
  </tr>`).join('');
}

function renderPlayerStatsForm(){
  const container = document.getElementById('playerStatsForm');
  const matchId = document.getElementById('pendingMatchSelect').value;
  const match = STATE.matches.find(m=>m.id===matchId);
  if(!match || !match.playerProps){ container.innerHTML = ''; return; }
  const COUNT_MARKETS = [
    ['atajadas','Atajadas'], ['faltas','Faltas cometidas'],
    ['remates','Remates'], ['remates_arco','Remates al arco'],
    ['gol','Goles'], ['asistencia','Asistencias']
  ];
  let html = '';
  for(const playerName in match.playerProps){
    const props = match.playerProps[playerName];
    html += `<div class="stat-player"><div class="stat-player-name">${playerName}</div><div class="stat-grid">`;
    for(const [market, label] of COUNT_MARKETS){
      if(props[market]===undefined) continue;
      html += `<div><label>${label}</label><input type="number" min="0" class="statInput" data-player="${playerName}" data-market="${market}" placeholder="0"></div>`;
    }
    html += `</div><div class="stat-checks">`;
    if(props.amarilla!==undefined) html += `<label><input type="checkbox" class="statCheck" data-player="${playerName}" data-market="amarilla">Amarilla</label>`;
    if(props.roja!==undefined) html += `<label><input type="checkbox" class="statCheck" data-player="${playerName}" data-market="roja">Roja</label>`;
    html += `</div><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--chalk-dim);margin-top:8px;"><input type="checkbox" class="statDidNotPlay" data-player="${playerName}">No jugó este partido</label></div>`;
  }
  container.innerHTML = html;
}

function renderAdmin(){
  const teamsList = document.getElementById('teamsList');
  teamsList.innerHTML = STATE.teams.length
    ? STATE.teams.slice().sort((a,b)=>b.rating-a.rating).map(t=>
        `<div class="team-line"><span class="crest">${initials(t.name)}</span><span class="name">${t.name}</span><span class="rating">${t.rating}</span></div>`
      ).join('')
    : '<div class="empty" style="padding:16px;">Agregá al menos dos equipos.</div>';

  const homeSel = document.getElementById('matchHome');
  const awaySel = document.getElementById('matchAway');
  const opts = STATE.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  homeSel.innerHTML = opts;
  awaySel.innerHTML = opts;

  const pendingSel = document.getElementById('pendingMatchSelect');
  const previousSelection = pendingSel.value;
  const pending = STATE.matches.filter(m=>m.status==='upcoming');
  pendingSel.innerHTML = pending.length
    ? pending.map(m=>`<option value="${m.id}">${m.homeName} vs ${m.awayName}</option>`).join('')
    : '<option value="">No hay partidos pendientes</option>';
  if(pending.some(m=>m.id===previousSelection)){
    pendingSel.value = previousSelection;
  }
  renderPlayerStatsForm();
}

function renderAll(skipAdmin){
  try{
    document.getElementById('playerNameLbl').textContent = ME;
    document.getElementById('chipCount').textContent = Math.round((STATE.users[ME] && STATE.users[ME].balance)||0);
    renderMatches();
    renderMyBets();
    renderRanking();
    if(!skipAdmin && isAdmin) renderAdmin();
    renderCartBar();
  }catch(e){
    toast('Hubo un error al mostrar los datos, avisale a quien programó esto');
  }
}

// ---------- init ----------
async function refreshSharedState(){
  STATE.teams = await loadShared('teams', STATE.teams);
  STATE.matches = await loadShared('matches', STATE.matches);
  STATE.bets = await loadShared('bets', STATE.bets);
  STATE.users = await loadShared('users', STATE.users);
  // no toca la pestaña Admin: evita perder un resultado que se está cargando a mitad de camino
  if(ME) renderAll(true);
}

(async function init(){
  await loadAll();
  await seedIfEmpty();
  await normalizeState();
  await syncLealProps();
  const savedName = await loadPersonal('my-name');
  const savedPassword = await loadPersonal('my-password');
  if(savedName && savedPassword && STATE.users[savedName] && STATE.users[savedName].password === savedPassword){
    ME = savedName;
    document.getElementById('gate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    renderAll();
  }else if(savedName){
    document.getElementById('nameInput').value = savedName;
  }
  const savedIsAdmin = await loadPersonal('is-admin');
  if(savedIsAdmin === 'yes'){
    isAdmin = true;
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
  }
  setInterval(refreshSharedState, 7000);
})();
</script>
</body>
</html>

```
