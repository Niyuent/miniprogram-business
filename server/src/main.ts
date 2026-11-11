import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const prefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(prefix);

  /**
   * 只信任**前置 Nginx 那一跳**（X-Forwarded-For 最右侧由 Nginx 追加）。
   * 这样 `req.ip` / `@Ip()` 拿到的是真实客户端 IP —— 入驻申请限流与审计日志的 ip 都依赖它。
   *
   * 前提：Nginx 已传 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
   * （`deploy/nginx/gateway.conf` 的三个 location 都已配）。
   *
   * ⚠️ 后端端口绝不能直接对外：外部请求可以自己伪造 XFF 头绕过往右数第 1 跳。
   * docker-compose 里只有 gateway 映射宿主端口，server 只在内网可达，满足该前提。
   */
  app.set('trust proxy', 1);

  // 本地磁盘上传目录：MVP 方案，Nginx 把 /uploads/ 反代到这里
  // 注意：静态资源不走 API 前缀，对外路径就是 /uploads/xxx
  const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  // Swagger 仅非生产环境暴露：接口文档会列出全部路由与鉴权方式，不适合对外
  if (process.env.NODE_ENV !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('商盟系统 API')
      .setDescription('代金券积分系统 · 网页端管理后台接口文档')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`服务已启动: http://localhost:${port}/${prefix}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`接口文档: http://localhost:${port}/api/docs`);
  } else {
    logger.log('接口文档: 已按 NODE_ENV=production 关闭');
  }
}

bootstrap();
