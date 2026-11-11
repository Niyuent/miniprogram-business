import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MiniBootstrapGuard } from './mini-bootstrap.guard';
import { MiniController } from './mini.controller';
import { MiniService } from './mini.service';

@Module({
  imports: [AuthModule],
  controllers: [MiniController],
  providers: [MiniService, MiniBootstrapGuard],
})
export class MiniModule {}
