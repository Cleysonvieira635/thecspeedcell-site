import siteConfig from './site-config.js';
import { resolveApiBase } from './api-url.js';

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const datetime = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const state = {
  token: null, nome: '', products: [], cart: [], category: '', authMode: 'login',
  pending: null, orderKey: null, config: null, catalogLoaded: false,
};
let toastTimer;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}

function openDialog(id) {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $(id).showModal();
}

async function api(path, { body, method = 'GET' } = {}) {
  const apiBase = resolveApiBase(siteConfig, location.origin);
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(35000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('A conexão demorou demais. Confira sua conta antes de tentar novamente.');
    throw new Error('Não foi possível conectar. Verifique a internet e se o servidor está disponível.');
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('O servidor retornou uma resposta inválida.');
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      state.token = null;
      state.nome = '';
      updateAccount();
      $('#portal-content').replaceChildren();
    }
    const messages = {
      400: 'Confira os dados informados.',
      401: path === '/auth/login' ? 'E-mail ou senha incorretos.' : 'Sua sessão expirou. Entre novamente.',
      403: 'Sua conta não tem permissão para esta operação.',
      409: 'Os dados foram alterados. Atualize e tente novamente.',
    };
    throw new Error(data?.message || messages[response.status] || 'Não foi possível concluir. Tente novamente mais tarde.');
  }
  return data;
}

function loadCart() {
  try {
    const stored = JSON.parse(localStorage.getItem('tsc-cart') || '[]');
    if (!Array.isArray(stored) || stored.some(item => !Number.isSafeInteger(item.id)
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
        || typeof item.nome !== 'string' || !Number.isFinite(item.preco) || item.preco <= 0)
        || stored.length > 30 || new Set(stored.map(item => item.id)).size !== stored.length) {
      throw new Error('Carrinho salvo inválido');
    }
    state.cart = stored;
  } catch (error) {
    console.warn('Não foi possível restaurar o carrinho:', error);
    toast('Não foi possível restaurar o carrinho salvo. Iniciamos um carrinho vazio.');
    state.cart = [];
  }
}

function saveCart() {
  state.orderKey = null;
  try {
    localStorage.setItem('tsc-cart', JSON.stringify(state.cart));
  } catch (error) {
    console.warn('Não foi possível salvar o carrinho:', error);
    toast('Seu navegador não permitiu salvar o carrinho. Ele será mantido apenas nesta página.');
  }
  renderCart();
}

function imageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, location.origin);
    return (url.protocol === 'https:' || (url.origin === location.origin && url.protocol === 'http:'))
      ? escapeHtml(url.href) : '';
  } catch {
    return '';
  }
}

function renderProducts() {
  const search = $('#product-search').value.toLocaleLowerCase('pt-BR').trim();
  const products = state.products.filter(product => (!state.category || product.categoria === state.category)
    && `${product.nome} ${product.categoria} ${product.descricao || ''}`.toLocaleLowerCase('pt-BR').includes(search));
  $('#product-list').innerHTML = products.length ? products.map(product => {
    const available = product.estoque > 0 && Number.isFinite(product.preco) && product.preco > 0;
    const image = imageUrl(product.imagem);
    return `<article class="product-card">
      <div class="product-art">${image ? `<img src="${image}" alt="${escapeHtml(product.nome)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="placeholder-icon" aria-hidden="true">▯</span>'}
      <span class="product-tag">${available ? 'Disponível' : 'Indisponível'}</span></div>
      <div class="product-info"><span class="product-category">${escapeHtml(product.categoria)}</span>
      <h3>${escapeHtml(product.nome)}</h3><p>${escapeHtml(product.descricao || 'Consulte a compatibilidade com seu aparelho.')}</p>
      <div class="product-bottom"><strong class="product-price">${product.preco > 0 ? money(product.preco) : 'Sob consulta'}</strong>
      <button class="add-product" data-add="${product.id}" ${available ? '' : 'disabled'} aria-label="Adicionar ${escapeHtml(product.nome)} ao carrinho">+</button></div></div></article>`;
  }).join('') : `<div class="empty-state">${state.products.length ? 'Nenhum acessório encontrado para essa busca.' : 'Nosso catálogo ainda está sendo preparado. Volte em breve para conferir os acessórios.'}</div>`;
  $('#product-list').querySelectorAll('img').forEach(image => {
    image.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'placeholder-icon';
      fallback.textContent = '▯';
      image.replaceWith(fallback);
    }, { once: true });
  });
}

async function loadProducts() {
  try {
    state.products = await api('/site/produtos');
    state.catalogLoaded = true;
    const categories = [...new Set(state.products.map(product => product.categoria))].sort();
    $('#categories').innerHTML = `<button class="chip active" data-category="" aria-pressed="true">Todos os produtos</button>${categories.map(category => `<button class="chip" data-category="${escapeHtml(category)}" aria-pressed="false">${escapeHtml(category)}</button>`).join('')}`;
    state.category = '';
    renderProducts();
  } catch (error) {
    state.catalogLoaded = false;
    $('#product-list').innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p><button class="button small outline" data-action="catalog">Tentar carregar catálogo ⟳</button></div>`;
  }
}

function renderCart() {
  $('#cart-count').textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $('#cart-items').innerHTML = state.cart.length ? state.cart.map(item => `
    <article class="cart-item"><div class="cart-item-info"><h3>${escapeHtml(item.nome)}</h3><p>${money(item.preco)} por unidade</p>
    <button class="remove-item" data-remove="${item.id}">Remover</button></div>
    <div class="quantity"><button data-quantity="${item.id}" data-delta="-1" aria-label="Diminuir quantidade de ${escapeHtml(item.nome)}">−</button><span>${item.quantity}</span><button data-quantity="${item.id}" data-delta="1" aria-label="Aumentar quantidade de ${escapeHtml(item.nome)}">+</button></div>
    <strong>${money(item.preco * item.quantity)}</strong></article>`).join('')
    : '<p class="portal-empty">Seu carrinho está vazio. Escolha um acessório para começar.</p>';
  $('#cart-total').textContent = money(state.cart.reduce((sum, item) => sum + item.preco * item.quantity, 0));
  $('#order-button').disabled = !state.cart.length;
  $('#cart-error').textContent = '';
}

function addProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product || product.estoque <= 0 || product.preco <= 0) throw new Error('Produto indisponível.');
  const item = state.cart.find(item => item.id === id);
  if ((item?.quantity || 0) >= Math.min(product.estoque, 99)) throw new Error('Quantidade máxima disponível atingida.');
  if (item) item.quantity++;
  else {
    if (state.cart.length >= 30) throw new Error('O carrinho permite até 30 produtos diferentes.');
    state.cart.push({ id, nome: product.nome, preco: product.preco, quantity: 1 });
  }
  saveCart();
  toast(`${product.nome} adicionado ao carrinho.`);
}

function changeQuantity(id, delta) {
  const item = state.cart.find(item => item.id === id);
  if (!item) return;
  const product = state.products.find(product => product.id === id);
  if (delta > 0 && (!state.catalogLoaded || !product || item.quantity >= Math.min(product.estoque, 99))) {
    throw new Error('Não há mais unidades disponíveis. Atualize o catálogo.');
  }
  item.quantity += delta;
  if (item.quantity < 1) state.cart = state.cart.filter(item => item.id !== id);
  saveCart();
}

function updateAccount() {
  $('#account-button').textContent = state.token ? `Olá, ${state.nome.split(' ')[0]}` : 'Minha conta ↗';
}

function requireAuth(next) {
  if (state.token) return next();
  state.pending = next;
  setAuthMode('login');
  openDialog('#auth-dialog');
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  $('#name-field').hidden = !register;
  $('#phone-field').hidden = !register;
  $('#auth-form [name=nome]').required = register;
  $('#auth-form [name=senha]').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-form [name=senha]').minLength = register ? 8 : 1;
  $('#auth-form [type=submit]').textContent = register ? 'Criar minha conta ↗' : 'Entrar na minha conta ↗';
  $('#auth-form .form-error').textContent = '';
  $('#login-tab').classList.toggle('active', !register);
  $('#register-tab').classList.toggle('active', register);
  $('#login-tab').setAttribute('aria-pressed', String(!register));
  $('#register-tab').setAttribute('aria-pressed', String(register));
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  form.querySelector('.form-error').textContent = '';
  const fields = Object.fromEntries(new FormData(form));
  const email = fields.email.trim().toLowerCase();
  try {
    if (state.authMode === 'register' && new TextEncoder().encode(fields.senha).length > 72) {
      throw new Error('A senha deve ter no máximo 72 bytes. Acentos e símbolos podem ocupar mais de um byte.');
    }
    if (state.authMode === 'register') {
      await api('/auth/register', { method: 'POST', body: {
        nome: fields.nome.trim(), email, telefone: fields.telefone.trim(), senha: fields.senha,
      } });
      setAuthMode('login');
      toast('Conta criada. Entrando na sua conta…');
    }
    const session = await api('/auth/login', { method: 'POST', body: { email, password: fields.senha } });
    state.token = session.token;
    state.nome = session.nome;
    form.reset();
    updateAccount();
    $('#auth-dialog').close();
    const next = state.pending;
    state.pending = null;
    if (next) await next();
    else await showPortal();
  } catch (error) {
    if ($('#auth-dialog').open) form.querySelector('.form-error').textContent = error.message;
    else toast(error.message);
  } finally {
    button.disabled = false;
  }
});

function showSchedule(service = '') {
  if (service) $('#schedule-form [name=problema]').value = service + ': ';
  return requireAuth(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const maximum = new Date(`${today}T12:00:00`);
    maximum.setDate(maximum.getDate() + 60);
    const date = $('#schedule-form [name=data]');
    date.min = today;
    date.max = `${maximum.getFullYear()}-${String(maximum.getMonth() + 1).padStart(2, '0')}-${String(maximum.getDate()).padStart(2, '0')}`;
    $('#schedule-form .form-error').textContent = '';
    openDialog('#schedule-dialog');
  });
}

$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  form.querySelector('.form-error').textContent = '';
  const fields = Object.fromEntries(new FormData(form));
  try {
    await api('/portal/agendamentos', { method: 'POST', body: {
      equipamento: fields.equipamento.trim(), problema: fields.problema.trim(),
      horario: `${fields.data}T${fields.hora}:00`,
    } });
    form.reset();
    toast('Avaliação agendada! Acompanhe os detalhes na sua conta.');
    await showPortal();
  } catch (error) {
    form.querySelector('.form-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function createOrder() {
  if (!state.cart.length) return;
  return requireAuth(async () => {
    openDialog('#cart-dialog');
    $('#order-button').disabled = true;
    $('#cart-error').textContent = '';
    try {
      state.orderKey ||= crypto.randomUUID();
      const order = await api('/portal/pedidos', { method: 'POST', body: {
        referencia: state.orderKey,
        itens: state.cart.map(item => ({ produtoId: item.id, quantidade: item.quantity })),
      } });
      state.cart = [];
      saveCart();
      toast(`Pedido #${order.id} criado. Nenhum pagamento foi cobrado.`);
      await showPortal();
      await loadProducts();
    } catch (error) {
      $('#cart-error').textContent = error.message;
      toast(error.message);
    } finally {
      $('#order-button').disabled = !state.cart.length;
    }
  });
}

function entry(title, status, content) {
  return `<article class="portal-entry"><div class="entry-top"><h3>${escapeHtml(title)}</h3><span class="status-badge">${escapeHtml(status)}</span></div>${content}</article>`;
}

async function showPortal() {
  if (!state.token) return requireAuth(showPortal);
  openDialog('#portal-dialog');
  $('#portal-greeting').textContent = `Olá, ${state.nome.split(' ')[0]}. Tudo por aqui.`;
  $('#portal-content').innerHTML = '<p class="portal-empty">Carregando suas informações…</p>';
  try {
    const [panel, appointments, orders] = await Promise.all([
      api('/portal'), api('/portal/agendamentos'), api('/portal/pedidos'),
    ]);
    const schedules = appointments.map(item => entry(item.atendimento.equipamento, 'Avaliação agendada',
      `<p>${datetime(item.horario)} — horário de Brasília</p><p class="fine-print">Protocolo: ${escapeHtml(item.atendimento.numero)}</p>`)).join('');
    const repairs = panel.atendimentos.map(item => entry(item.equipamento, item.status,
      `<p>${escapeHtml(item.problema)}</p><p class="fine-print">Protocolo: ${escapeHtml(item.numero)}</p>`)).join('');
    const proposals = panel.orcamentos.map(item => entry(`Orçamento • ${item.equipamento}`, item.status,
      `<strong>${money(item.total)}</strong><ul class="entry-items">${item.itens.map(line => `<li>${line.quantidade} × ${escapeHtml(line.descricao)} — ${money(line.valorTotal)}</li>`).join('')}</ul>
      ${item.validade ? `<p>Válido até ${datetime(item.validade)}</p>` : ''}
      ${item.status === 'Aguardando aprovação' ? `<div class="entry-actions"><button class="button small" data-decision="${item.id}" data-status="Aprovado">Aprovar orçamento</button><button class="button small outline" data-decision="${item.id}" data-status="Recusado">Recusar</button></div>` : ''}`)).join('');
    const purchases = orders.map(order => entry(`Pedido #${order.id}`, order.status,
      `<strong>${money(order.total)}</strong><ul class="entry-items">${order.itens.map(item => `<li>${item.quantidade} × ${escapeHtml(item.nome)} — ${money(item.preco)}</li>`).join('')}</ul>
      <p class="fine-print">Criado em ${datetime(order.criadoEm)}. Retirada na loja.</p>
      ${order.status === 'Aguardando pagamento' ? '<p class="fine-print">Já pagou? Verifique a confirmação abaixo. Não pague o mesmo pedido mais de uma vez.</p><div class="entry-actions"><button class="button small" data-checkout="' + order.id + '">Pagar com Mercado Pago ↗</button><button class="button small outline" data-payment="' + order.id + '">Verificar pagamento ⟳</button></div>' : ''}`)).join('');
    const payments = panel.pagamentos.map(payment => entry(`Pagamento • ${payment.numeroAtendimento}`, payment.formaPagamento,
      `<strong>${money(payment.valor)}</strong><p class="fine-print">${datetime(payment.dataPagamento)}</p>`)).join('');
    const section = (title, content, empty) => `<h3 class="portal-section-title">${title}</h3>${content || `<p class="portal-empty">${empty}</p>`}`;
    $('#portal-content').innerHTML = section('Meus agendamentos', schedules, 'Você ainda não tem agendamentos.')
      + section('Acompanhamento de reparos', repairs, 'Seus reparos aparecerão aqui.')
      + section('Meus orçamentos', proposals, 'Nenhum orçamento disponível.')
      + section('Meus pedidos', purchases, 'Você ainda não fez pedidos.')
      + section('Pagamentos de assistência', payments, 'Nenhum recebimento registrado pela loja.');
  } catch (error) {
    $('#portal-content').innerHTML = `<p class="form-error" role="alert">${escapeHtml(error.message)}</p><button class="button outline" data-action="${state.token ? 'refresh' : 'account'}">${state.token ? 'Tentar novamente' : 'Entrar novamente'} ↗</button>`;
  }
}

async function checkout(id, button) {
  button.disabled = true;
  try {
    const result = await api(`/portal/pedidos/${id}/checkout`, { method: 'POST' });
    const target = new URL(result.url);
    if (target.protocol !== 'https:' || !(target.hostname === 'mercadopago.com.br' || target.hostname.endsWith('.mercadopago.com.br'))) {
      throw new Error('O servidor retornou um link de pagamento inválido.');
    }
    location.assign(target.href);
  } finally {
    button.disabled = false;
  }
}

async function whatsapp() {
  const phone = siteConfig.whatsapp || (await api('/site/config')).whatsapp;
  if (!/^\d{12,15}$/.test(phone || '')) throw new Error('O WhatsApp da loja ainda não foi configurado. Use o agendamento online.');
  location.assign(`https://wa.me/${phone}?text=${encodeURIComponent('Olá! Preciso de uma orientação da ThecSpeedCell.')}`);
}

const actions = {
  schedule: () => showSchedule(),
  portal: () => requireAuth(showPortal),
  account: () => {
    if (state.token) return showPortal();
    state.pending = null;
    setAuthMode('login');
    openDialog('#auth-dialog');
  },
  cart: () => { renderCart(); openDialog('#cart-dialog'); },
  order: createOrder,
  refresh: showPortal,
  catalog: loadProducts,
  whatsapp,
  privacy: () => openDialog('#privacy-dialog'),
  logout: () => {
    state.token = null;
    state.nome = '';
    state.pending = null;
    $('#portal-content').replaceChildren();
    $('#portal-dialog').close();
    updateAccount();
    toast('Você saiu da sua conta.');
  },
};

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  try {
    if (button.hasAttribute('data-close')) return button.closest('dialog').close();
    if (button.dataset.action) return await actions[button.dataset.action]?.();
    if (button.dataset.service) return await showSchedule(button.dataset.service);
    if (button.dataset.authMode) return setAuthMode(button.dataset.authMode);
    if (button.dataset.add) return addProduct(Number(button.dataset.add));
    if (button.dataset.remove) {
      state.cart = state.cart.filter(item => item.id !== Number(button.dataset.remove));
      return saveCart();
    }
    if (button.dataset.quantity) return changeQuantity(Number(button.dataset.quantity), Number(button.dataset.delta));
    if (button.hasAttribute('data-category')) {
      state.category = button.dataset.category;
      $('#categories').querySelectorAll('button').forEach(chip => {
        chip.classList.toggle('active', chip === button);
        chip.setAttribute('aria-pressed', String(chip === button));
      });
      return renderProducts();
    }
    if (button.dataset.checkout) return await checkout(Number(button.dataset.checkout), button);
    if (button.dataset.payment) {
      button.disabled = true;
      try {
        await api(`/portal/pedidos/${button.dataset.payment}/confirmar-pagamento`, { method: 'POST' });
        toast('Pagamento confirmado pelo Mercado Pago.');
        await showPortal();
      } finally { button.disabled = false; }
      return;
    }
    if (button.dataset.decision) {
      button.disabled = true;
      try {
        await api(`/portal/orcamentos/${button.dataset.decision}/decisao`, {
          method: 'PATCH', body: { status: button.dataset.status },
        });
        toast('Sua decisão foi registrada.');
        await showPortal();
      } finally { button.disabled = false; }
    }
  } catch (error) {
    toast(error.message);
  }
});

$('#product-search').addEventListener('input', () => { if (state.catalogLoaded) renderProducts(); });
$('#year').textContent = new Date().getFullYear();
document.querySelectorAll('dialog').forEach(dialog => {
  const title = dialog.querySelector('h2');
  title.id ||= `${dialog.id}-title`;
  dialog.setAttribute('aria-labelledby', title.id);
});
loadCart();
renderCart();
loadProducts();
